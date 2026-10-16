import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QrPayload } from "@/domain/scanning";

/**
 * Operators paste QR keys in whatever shape their tool produced. A format the
 * loader rejects means no gate QR and no pass email for anyone, so every
 * common shape must sign + verify, and real misconfigurations must fail loudly.
 */

const KEYS = ["QR_ED25519_PRIVATE_KEY_BASE64", "QR_ED25519_PUBLIC_KEY_BASE64", "QR_SIGNING_KEY_ID"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function payload(): QrPayload {
  const now = Math.floor(Date.now() / 1000);
  return { v: 1, jti: "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d", fest: "f", pass: "PP-1", entv: 1, nbf: now - 60, exp: now + 3600, class: "BASE" };
}

async function loadWith(priv: string | undefined, pub: string | undefined) {
  if (priv === undefined) delete process.env.QR_ED25519_PRIVATE_KEY_BASE64;
  else process.env.QR_ED25519_PRIVATE_KEY_BASE64 = priv;
  if (pub === undefined) delete process.env.QR_ED25519_PUBLIC_KEY_BASE64;
  else process.env.QR_ED25519_PUBLIC_KEY_BASE64 = pub;
  process.env.QR_SIGNING_KEY_ID = "k1";
  vi.resetModules();
  return import("@/lib/qr/credential");
}

const pair = () => generateKeyPairSync("ed25519");
const der = (k: KeyObject, type: "pkcs8" | "spki") => k.export({ type, format: "der" });
const pem = (k: KeyObject, type: "pkcs8" | "spki") => k.export({ type, format: "pem" }).toString();

async function roundTrip(priv: string | undefined, pub: string | undefined) {
  const qr = await loadWith(priv, pub);
  const token = await qr.signQrToken(payload());
  return qr.verifyQrToken(token);
}

describe("QR key formats", () => {
  it("accepts base64 PKCS#8/SPKI DER (the documented format)", async () => {
    const { privateKey, publicKey } = pair();
    const v = await roundTrip(der(privateKey, "pkcs8").toString("base64"), der(publicKey, "spki").toString("base64"));
    expect(v.reason).toBe("ok");
  });

  it("accepts PEM, raw or base64-encoded or with escaped newlines", async () => {
    const { privateKey, publicKey } = pair();
    expect((await roundTrip(pem(privateKey, "pkcs8"), pem(publicKey, "spki"))).reason).toBe("ok");
    expect(
      (await roundTrip(
        Buffer.from(pem(privateKey, "pkcs8")).toString("base64"),
        Buffer.from(pem(publicKey, "spki")).toString("base64")
      )).reason
    ).toBe("ok");
    expect((await roundTrip(pem(privateKey, "pkcs8").replace(/\n/g, "\\n"), undefined)).reason).toBe("ok");
  });

  it("accepts raw 32-byte keys and a 64-byte libsodium secret key", async () => {
    const { privateKey, publicKey } = pair();
    const seed = der(privateKey, "pkcs8").subarray(16);
    const rawPub = der(publicKey, "spki").subarray(12);
    expect((await roundTrip(seed.toString("base64"), rawPub.toString("base64"))).reason).toBe("ok");
    expect((await roundTrip(Buffer.concat([seed, rawPub]).toString("base64"), undefined)).reason).toBe("ok");
  });

  it("derives the public key when only the private key is set", async () => {
    const { privateKey } = pair();
    expect((await roundTrip(der(privateKey, "pkcs8").toString("base64"), undefined)).reason).toBe("ok");
  });

  it("refuses to sign with a mismatched keypair instead of issuing QRs gates reject", async () => {
    const a = pair();
    const b = pair();
    const qr = await loadWith(der(a.privateKey, "pkcs8").toString("base64"), der(b.publicKey, "spki").toString("base64"));
    await expect(qr.signQrToken(payload())).rejects.toThrow(/does not match/);
  });

  it("explains a missing or unreadable key", async () => {
    let qr = await loadWith(undefined, undefined);
    await expect(qr.signQrToken(payload())).rejects.toThrow(/not configured.*qr:keygen/);
    qr = await loadWith("bm90LWEta2V5LWF0LWFsbC1qdXN0LXRleHQ=", undefined);
    await expect(qr.signQrToken(payload())).rejects.toThrow(/could not be read as an Ed25519 private key/);
  });

  it("a key misconfiguration at the gate is an error, never a fake 'invalid signature'", async () => {
    const { privateKey } = pair();
    const token = await (await loadWith(der(privateKey, "pkcs8").toString("base64"), undefined)).signQrToken(payload());
    const broken = await loadWith(undefined, undefined);
    await expect(broken.verifyQrToken(token)).rejects.toThrow(/not configured/);
  });
});
