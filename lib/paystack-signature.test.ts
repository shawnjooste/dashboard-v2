import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaystackSignature } from "./paystack-signature";

const SECRET = "sk_test_dummy_for_tests";
const body = JSON.stringify({ event: "charge.success", data: { reference: "bk_x", amount: 115000 } });
const sig = createHmac("sha512", SECRET).update(body).digest("hex");

describe("verifyPaystackSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyPaystackSignature(body, sig, SECRET)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyPaystackSignature(body.replace("115000", "1"), sig, SECRET)).toBe(false);
  });
  it("rejects a missing signature", () => {
    expect(verifyPaystackSignature(body, null, SECRET)).toBe(false);
  });
  it("rejects a malformed signature without throwing", () => {
    expect(verifyPaystackSignature(body, "zz-not-hex", SECRET)).toBe(false);
  });
  it("rejects a signature made with the wrong secret", () => {
    const wrong = createHmac("sha512", "some_other_secret").update(body).digest("hex");
    expect(verifyPaystackSignature(body, wrong, SECRET)).toBe(false);
  });
});
