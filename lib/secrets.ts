import crypto from "node:crypto";

export type Sealed = { ciphertext: string; iv: string; tag: string };

function keyBuf(keyBase64: string): Buffer {
  const k = Buffer.from(keyBase64, "base64");
  if (k.length !== 32) throw new Error("encryption key must be 32 bytes (base64)");
  return k;
}

/** AES-256-GCM, wire-compatible with lib/m365-graph.mjs's helpers. */
export function encryptSecret(plaintext: string, keyBase64: string): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf(keyBase64), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret({ ciphertext, iv, tag }: Sealed, keyBase64: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf(keyBase64), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** The key protecting connectivity line credentials. */
export function connectivityKey(): string {
  const k = process.env.CONNECTIVITY_ENC_KEY;
  if (!k) throw new Error("CONNECTIVITY_ENC_KEY is not set");
  return k;
}
