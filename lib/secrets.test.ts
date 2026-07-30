import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("secrets", () => {
  it("round-trips a value", () => {
    const sealed = encryptSecret("hunter2-pppoe", KEY);
    expect(sealed.ciphertext).not.toContain("hunter2");
    expect(decryptSecret(sealed, KEY)).toBe("hunter2-pppoe");
  });
  it("produces a fresh iv each time", () => {
    expect(encryptSecret("x", KEY).iv).not.toBe(encryptSecret("x", KEY).iv);
  });
  it("rejects a tampered payload", () => {
    const sealed = encryptSecret("secret", KEY);
    expect(() =>
      decryptSecret({ ...sealed, ciphertext: Buffer.from("evil").toString("base64") }, KEY),
    ).toThrow();
  });
  it("rejects a wrong-size key", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16, 1).toString("base64"))).toThrow(/32 bytes/);
  });
});
