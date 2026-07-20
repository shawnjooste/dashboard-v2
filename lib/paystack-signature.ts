import { createHmac, timingSafeEqual } from "node:crypto";

/** Paystack signs the RAW webhook body with your secret key (HMAC-SHA512,
 *  hex, in the x-paystack-signature header). Constant-time comparison —
 *  this check is the webhook's entire authentication. */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
