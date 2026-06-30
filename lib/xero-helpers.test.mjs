import { describe, it, expect } from "vitest";
import { parseXeroDate, isVisibleStatus, normalizeInvoice, summarize, groupInvoices } from "./xero-helpers.mjs";

describe("parseXeroDate", () => {
  it("handles Xero /Date()/ and ISO", () => {
    expect(parseXeroDate("/Date(1782864000000+0000)/")).toBe("2026-07-01");
    expect(parseXeroDate("2026-07-01T00:00:00")).toBe("2026-07-01");
    expect(parseXeroDate(null)).toBe(null);
  });
  it("applies a non-UTC offset so the day doesn't shift", () => {
    // 2026-06-30 22:00 UTC is 2026-07-01 00:00 in +0200 — the intended date is the 1st.
    const ms = Date.parse("2026-06-30T22:00:00Z");
    expect(parseXeroDate(`/Date(${ms}+0200)/`)).toBe("2026-07-01");
    expect(parseXeroDate(`/Date(${ms}+0000)/`)).toBe("2026-06-30");
  });
});

describe("isVisibleStatus", () => {
  it("only AUTHORISED/PAID", () => {
    expect(isVisibleStatus("AUTHORISED")).toBe(true);
    expect(isVisibleStatus("PAID")).toBe(true);
    expect(isVisibleStatus("DRAFT")).toBe(false);
    expect(isVisibleStatus("VOIDED")).toBe(false);
  });
});

describe("normalizeInvoice", () => {
  it("maps Xero fields", () => {
    const n = normalizeInvoice({
      InvoiceID: "abc", InvoiceNumber: "INV-2766", Status: "AUTHORISED",
      Date: "/Date(1782777600000+0000)/", DueDate: "/Date(1782864000000+0000)/",
      Total: 50361.95, AmountDue: 50361.95, AmountPaid: 0, CurrencyCode: "ZAR",
    }, "invoice");
    expect(n.xero_invoice_id).toBe("abc");
    expect(n.number).toBe("INV-2766");
    expect(n.due_date).toBe("2026-07-01");
    expect(n.amount_due).toBe(50361.95);
  });
});

describe("summarize", () => {
  it("totals outstanding + overdue", () => {
    const inv = [
      normalizeInvoice({ InvoiceID: "1", Status: "AUTHORISED", DueDate: "/Date(1782950400000+0000)/", Total: 100, AmountDue: 100, AmountPaid: 0, CurrencyCode: "ZAR" }, "invoice"),
      normalizeInvoice({ InvoiceID: "2", Status: "PAID", DueDate: "/Date(1782950400000+0000)/", Total: 50, AmountDue: 0, AmountPaid: 50, CurrencyCode: "ZAR" }, "invoice"),
      normalizeInvoice({ InvoiceID: "3", Status: "AUTHORISED", DueDate: "/Date(1577836800000+0000)/", Total: 30, AmountDue: 30, AmountPaid: 0, CurrencyCode: "ZAR" }, "invoice"),
    ];
    const s = summarize(inv, "2026-06-30");
    expect(s.outstanding).toBe(130); // 100 + 30 still due
    expect(s.overdue).toBe(30); // only #3 is past due (2020 date)
    expect(s.currency).toBe("ZAR");
  });
});

describe("groupInvoices", () => {
  it("splits open / paid / credit notes", () => {
    const g = groupInvoices([
      { type: "invoice", status: "AUTHORISED", amount_due: 100 },
      { type: "invoice", status: "PAID", amount_due: 0 },
      { type: "credit_note", status: "PAID", amount_due: 0 },
    ]);
    expect(g.open.length).toBe(1);
    expect(g.paid.length).toBe(1);
    expect(g.creditNotes.length).toBe(1);
  });
});
