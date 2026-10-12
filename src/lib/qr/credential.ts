import "server-only";
import { createHash, createHmac } from "node:crypto";
import * as jose from "jose";
import { env } from "@/lib/env";
import type { QrPayload } from "@/domain/scanning";

/**
 * QR credential format (plan §14.1):
 *
 *   P1.<kid>.<base64url(canonical payload)>.<base64url(Ed25519 signature)>
 *
 * The payload is canonicalized deterministically (fixed key order, no
 * whitespace) before signing — never raw JSON.stringify of arbitrary
 * objects. The payload carries no PII: only a random jti, scope metadata,
 * and a validity window.
 */

const CANONICAL_KEYS = ["v", "jti", "fest", "pass", "entv", "nbf", "exp", "class"] as const;

export function canonicalize(payload: QrPayload): string {
  return JSON.stringify(
    Object.fromEntries(CANONICAL_KEYS.map((k) => [k, payload[k]]))
  );
}

function getPrivateKey(): Uint8Array {
  const e = env();
  if (!e.QR_ED25519_PRIVATE_KEY_BASE64) {
    throw new Error("QR_ED25519_PRIVATE_KEY_BASE64 is not configured");
  }
  return new Uint8Array(Buffer.from(e.QR_ED25519_PRIVATE_KEY_BASE64, "base64"));
}

function getPublicKey(): Uint8Array {
  const e = env();
  if (!e.QR_ED25519_PUBLIC_KEY_BASE64) {
    throw new Error("QR_ED25519_PUBLIC_KEY_BASE64 is not configured");
  }
  return new Uint8Array(Buffer.from(e.QR_ED25519_PUBLIC_KEY_BASE64, "base64"));
}

/** Sign a payload into the compact P1 token. */
export async function signQrToken(payload: QrPayload): Promise<string> {
  const kid = env().QR_SIGNING_KEY_ID;
  const canonical = canonicalize(payload);
  const key = await jose.importPKCS8(
    pemFromRaw(getPrivateKey(), "PRIVATE KEY"),
    "EdDSA"
  );
  const signature = await new jose.CompactSign(
    new TextEncoder().encode(canonical)
  )
    .setProtectedHeader({ alg: "EdDSA", kid })
    .sign(key);
  // Compact JWS: header.payload.signature — we embed kid explicitly too.
  const parts = signature.split(".");
  const payloadB64 = parts[1];
  const sigB64 = parts[2];
  return `P1.${kid}.${payloadB64}.${sigB64}`;
}

export interface VerifiedToken {
  valid: boolean;
  payload: QrPayload | null;
  reason:
    | "ok"
    | "invalid_format"
    | "invalid_signature"
    | "unknown_key"
    | "expired"
    | "not_yet_valid";
}

/** Verify a P1 token's signature and time window (server time). */
export async function verifyQrToken(token: string): Promise<VerifiedToken> {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "P1") {
    return { valid: false, payload: null, reason: "invalid_format" };
  }
  const [, kid, payloadB64, sigB64] = parts;
  if (kid !== env().QR_SIGNING_KEY_ID) {
    // Previous keys could be supported here during rotation (plan §14.3).
    return { valid: false, payload: null, reason: "unknown_key" };
  }

  try {
    const key = await jose.importSPKI(
      pemFromRaw(getPublicKey(), "PUBLIC KEY"),
      "EdDSA"
    );
    // Rebuild a JWS to verify with jose.
    const headerB64 = base64url(
      JSON.stringify({ alg: "EdDSA", kid })
    );
    const jws = `${headerB64}.${payloadB64}.${sigB64}`;
    const { payload: raw } = await jose.compactVerify(jws, key);
    const parsed = JSON.parse(new TextDecoder().decode(raw)) as QrPayload;

    const now = Math.floor(Date.now() / 1000);
    if (parsed.exp && now > parsed.exp) {
      return { valid: false, payload: parsed, reason: "expired" };
    }
    if (parsed.nbf && now < parsed.nbf) {
      return { valid: false, payload: parsed, reason: "not_yet_valid" };
    }
    return { valid: true, payload: parsed, reason: "ok" };
  } catch {
    return { valid: false, payload: null, reason: "invalid_signature" };
  }
}

/** Keyed digest of a token for storage/audit (never the raw token). */
export function tokenDigest(token: string): string {
  const e = env();
  return createHmac("sha256", e.QR_SIGNING_KEY_ID)
    .update(token)
    .digest("hex");
}

/** Content hash used for idempotent issuance. */
export function payloadDigest(payload: QrPayload): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

function base64url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64url");
}

function pemFromRaw(raw: Uint8Array, label: string): string {
  const b64 = Buffer.from(raw).toString("base64");
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}
