#!/usr/bin/env node
/**
 * Generate the Ed25519 keypair that signs gate QR codes and print the exact
 * .env lines (base64 PKCS#8 / SPKI DER — the format src/lib/qr/credential.ts
 * documents). Usage: pnpm qr:keygen [key-id]
 *
 * Changing keys invalidates every QR already issued under the old key id:
 * use a new key id (k2, k3, …) and let passes re-render their QR from the
 * dashboard / resend the pass emails.
 */
import { generateKeyPairSync } from "node:crypto";

const keyId = process.argv[2] ?? "k1";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");

console.log(`QR_SIGNING_KEY_ID=${keyId}`);
console.log(
  `QR_ED25519_PRIVATE_KEY_BASE64=${privateKey.export({ type: "pkcs8", format: "der" }).toString("base64")}`
);
console.log(
  `QR_ED25519_PUBLIC_KEY_BASE64=${publicKey.export({ type: "spki", format: "der" }).toString("base64")}`
);
