// Server-owned quote template constants — the values a caller of the quote
// API can never see or override. Copied verbatim from scripts/qu-sun-002.json
// (the current live values) plus the standing standard-terms set used across
// recent quotes (scripts/qu-*.json). No imports: this file is pure data so it
// can be trivially unit-tested and imported from plain Node.
import type { QuoteDoc } from "./doc.ts";

export const COMPANY: QuoteDoc["company"] = {
  name: "Rocking (PTY) LTD",
  addressLines: ["Unit A3, Westlake Square", "Westlake Drive, Westlake, 7945"],
  vat: "4810312173",
  regNumber: "2013/047237/07",
  registeredOffice: "Unit A3, Westlake Square, Westlake Drive, Westlake, 7945, South Africa",
};

export const BANKING: QuoteDoc["banking"] = {
  bank: "First National Bank",
  account: "63023869192",
  branch: "Blue Route Mall, Tokai Road, Tokai, 7945",
  branchCode: "250655",
  reference: "Please use quote number as payment reference.",
};

// The four standing terms every quote carries, in canonical order: validity,
// ex-VAT, payment-prior-to-order (the default/EFT wording — the assembler
// swaps this slot for CHECKOUT_PAYMENT_TERM when checkout is enabled), and
// ownership-until-paid.
export const STANDARD_TERMS: readonly string[] = [
  "This quote is valid for 14 days from the date of issue.",
  "All prices exclude VAT at 15% unless otherwise stated.",
  "Payment is due prior to order placement.",
  "Goods remain the property of Rocking until paid in full.",
];

export const CHECKOUT_PAYMENT_TERM =
  "Payment is made online by card using the payment button on this quote.";
// Aliased to STANDARD_TERMS[2] (not a second copy of the wording) so the two
// can never drift apart silently — the pinning test in api-input.test.ts
// checks STANDARD_TERMS verbatim, and this constant rides along with it.
export const EFT_PAYMENT_TERM = STANDARD_TERMS[2];

export const VALIDITY_DAYS = 14;
