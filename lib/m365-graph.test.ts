import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { encryptSecret, decryptSecret } from "./m365-graph.mjs";

const key = crypto.randomBytes(32).toString("base64");

describe("m365 token crypto", () => {
  it("round-trips a secret", () => {
    const secret = "0.AReallyLong-Refresh_Token~value";
    const enc = encryptSecret(secret, key);
    expect(enc.ciphertext).not.toContain(secret);
    expect(decryptSecret(enc, key)).toBe(secret);
  });

  it("produces a fresh iv each time", () => {
    expect(encryptSecret("x", key).iv).not.toBe(encryptSecret("x", key).iv);
  });

  it("detects tampering via the GCM auth tag", () => {
    const enc = encryptSecret("secret", key);
    const tampered = { ...enc, ciphertext: Buffer.from("evil").toString("base64") };
    expect(() => decryptSecret(tampered, key)).toThrow();
  });

  it("rejects a wrong-size key", () => {
    expect(() => encryptSecret("x", Buffer.from("short").toString("base64"))).toThrow();
  });
});
