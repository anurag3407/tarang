import "server-only";
import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
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

/**
 * Key loading. Operators paste keys in whatever shape their tool produced, so
 * accept every common one rather than failing every QR (and, through it,
 * every pass email) on a format detail:
 *   - base64 of PKCS#8 / SPKI DER        (the documented format)
 *   - PEM, raw or base64-encoded, with real or "\n"-escaped newlines
 *   - base64 of the raw 32-byte Ed25519 seed / public key
 *   - base64 of a 64-byte libsodium/tweetnacl secret key (seed || public)
 * The public key is optional: it is derived from the private key when unset.
 */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function decodeKeyMaterial(value: string): { pem: string } | { der: Buffer } {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  if (trimmed.includes("-----BEGIN")) return { pem: trimmed.replace(/\\n/g, "\n") };
  const bytes = Buffer.from(trimmed, "base64");
  const text = bytes.toString("utf8");
  if (text.includes("-----BEGIN")) return { pem: text.replace(/\\n/g, "\n") };
  return { der: bytes };
}

function assertEd25519(key: KeyObject, which: string): KeyObject {
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error(`${which} is a ${key.asymmetricKeyType ?? "non-asymmetric"} key, not Ed25519`);
  }
  return key;
}

let privateKeyCache: { source: string; key: KeyObject } | null = null;
let publicKeyCache: { source: string; key: KeyObject } | null = null;
let pairCheckedFor: string | null = null;

function loadPrivateKey(): KeyObject {
  const value = env().QR_ED25519_PRIVATE_KEY_BASE64;
  if (!value) {
    throw new Error("QR_ED25519_PRIVATE_KEY_BASE64 is not configured — run `pnpm qr:keygen`");
  }
  if (privateKeyCache?.source === value) return privateKeyCache.key;
  let key: KeyObject;
  try {
    const material = decodeKeyMaterial(value);
    if ("pem" in material) {
      key = createPrivateKey(material.pem);
    } else if (material.der.length === 32 || material.der.length === 64) {
      const seed = material.der.subarray(0, 32);
      key = createPrivateKey({
        key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
        format: "der",
        type: "pkcs8",
      });
    } else {
      key = createPrivateKey({ key: material.der, format: "der", type: "pkcs8" });
    }
  } catch (err) {
    throw new Error(
      `QR_ED25519_PRIVATE_KEY_BASE64 could not be read as an Ed25519 private key (${
        err instanceof Error ? err.message : String(err)
      }) — run \`pnpm qr:keygen\``
    );
  }
  assertEd25519(key, "QR_ED25519_PRIVATE_KEY_BASE64");
  privateKeyCache = { source: value, key };
  return key;
}

function loadPublicKey(): KeyObject {
  const value = env().QR_ED25519_PUBLIC_KEY_BASE64;
  if (!value) return createPublicKey(loadPrivateKey());
  if (publicKeyCache?.source === value) return publicKeyCache.key;
  let key: KeyObject;
  try {
    const material = decodeKeyMaterial(value);
    if ("pem" in material) {
      key = createPublicKey(material.pem);
    } else if (material.der.length === 32) {
      key = createPublicKey({
        key: Buffer.concat([SPKI_ED25519_PREFIX, material.der]),
        format: "der",
        type: "spki",
      });
    } else {
      key = createPublicKey({ key: material.der, format: "der", type: "spki" });
    }
  } catch (err) {
    throw new Error(
      `QR_ED25519_PUBLIC_KEY_BASE64 could not be read as an Ed25519 public key (${
        err instanceof Error ? err.message : String(err)
      })`
    );
  }
  assertEd25519(key, "QR_ED25519_PUBLIC_KEY_BASE64");
  publicKeyCache = { source: value, key };
  return key;
}

/**
 * Refuse to sign with a private key whose configured public key does not
 * match: every QR issued that way would be rejected at the gate.
 */
function signingKey(): KeyObject {
  const priv = loadPrivateKey();
  const e = env();
  const pairId = `${e.QR_ED25519_PRIVATE_KEY_BASE64}|${e.QR_ED25519_PUBLIC_KEY_BASE64 ?? ""}`;
  if (pairCheckedFor !== pairId) {
    const probe = Buffer.from("tarang-qr-keypair-check");
    if (!edVerify(null, probe, loadPublicKey(), edSign(null, probe, priv))) {
      throw new Error(
        "QR_ED25519_PUBLIC_KEY_BASE64 does not match QR_ED25519_PRIVATE_KEY_BASE64 — " +
          "gates would reject every QR. Set both from one `pnpm qr:keygen` run (or unset the public key)."
      );
    }
    pairCheckedFor = pairId;
  }
  return priv;
}

/** Sign a payload into the compact P1 token. */
export async function signQrToken(payload: QrPayload): Promise<string> {
  const kid = env().QR_SIGNING_KEY_ID;
  const canonical = canonicalize(payload);
  const key = signingKey();
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

  // Outside the try: a key configuration error must surface as a server error,
  // not be reported as a forged QR for every genuine pass.
  const key = loadPublicKey();
  try {
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
