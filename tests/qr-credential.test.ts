import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

// Generate a throwaway Ed25519 keypair for the test process. The env vars
// hold DER bytes (PKCS8/SPKI) base64-encoded, matching how production stores
// them (the documented format; see tests/qr-key-formats.test.ts for the rest).
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
process.env.QR_ED25519_PRIVATE_KEY_BASE64 = privateKey
  .export({ type: "pkcs8", format: "der" })
  .toString("base64");
process.env.QR_ED25519_PUBLIC_KEY_BASE64 = publicKey
  .export({ type: "spki", format: "der" })
  .toString("base64");
process.env.QR_SIGNING_KEY_ID = "k1";

import {
  canonicalize,
  payloadDigest,
  signQrToken,
  tokenDigest,
  verifyQrToken,
} from "@/lib/qr/credential";
import type { QrPayload } from "@/domain/scanning";

function payload(overrides: Partial<QrPayload> = {}): QrPayload {
  const now = Math.floor(Date.now() / 1000);
  return {
    v: 1,
    jti: "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d",
    fest: "fest-id",
    pass: "pass-id",
    entv: 1,
    nbf: now - 60,
    exp: now + 3600,
    class: "DELEGATE",
    ...overrides,
  };
}

describe("QR credential signing (plan §14.1)", () => {
  it("signs and verifies a valid token", async () => {
    const token = await signQrToken(payload());
    expect(token.startsWith("P1.k1.")).toBe(true);
    const verified = await verifyQrToken(token);
    expect(verified.valid).toBe(true);
    expect(verified.reason).toBe("ok");
    expect(verified.payload?.class).toBe("DELEGATE");
  });

  it("rejects a tampered payload", async () => {
    const token = await signQrToken(payload());
    const parts = token.split(".");
    // Flip a character in the payload segment.
    const tamperedPayload =
      parts[2].slice(0, 5) + (parts[2][5] === "A" ? "B" : "A") + parts[2].slice(6);
    const tampered = [parts[0], parts[1], tamperedPayload, parts[3]].join(".");
    const verified = await verifyQrToken(tampered);
    expect(verified.valid).toBe(false);
    expect(["invalid_signature", "invalid_format"]).toContain(verified.reason);
  });

  it("rejects an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signQrToken(payload({ nbf: now - 7200, exp: now - 3600 }));
    const verified = await verifyQrToken(token);
    expect(verified.valid).toBe(false);
    expect(verified.reason).toBe("expired");
  });

  it("rejects a token not yet valid", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signQrToken(payload({ nbf: now + 3600, exp: now + 7200 }));
    const verified = await verifyQrToken(token);
    expect(verified.valid).toBe(false);
    expect(verified.reason).toBe("not_yet_valid");
  });

  it("rejects tokens signed under an unknown key id", async () => {
    const token = await signQrToken(payload());
    const parts = token.split(".");
    const forged = [parts[0], "k99", parts[2], parts[3]].join(".");
    const verified = await verifyQrToken(forged);
    expect(verified.valid).toBe(false);
    expect(verified.reason).toBe("unknown_key");
  });

  it("rejects malformed tokens without throwing", async () => {
    for (const garbage of ["", "P1", "P1.k1.only.two", "XX.k1.a.b.c", "not a token"]) {
      const verified = await verifyQrToken(garbage);
      expect(verified.valid).toBe(false);
    }
  });

  it("canonicalizes payloads deterministically regardless of key order", () => {
    const p = payload();
    const shuffled = Object.fromEntries(Object.entries(p).reverse()) as unknown as QrPayload;
    expect(canonicalize(p)).toBe(canonicalize(shuffled));
    expect(payloadDigest(p)).toBe(payloadDigest(shuffled));
  });

  it("token digests are stable and distinct per token", async () => {
    const a = await signQrToken(payload());
    const b = await signQrToken(payload({ jti: "7f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d" }));
    expect(tokenDigest(a)).toBe(tokenDigest(a));
    expect(tokenDigest(a)).not.toBe(tokenDigest(b));
  });
});
