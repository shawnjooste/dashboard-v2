import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXeroDate, isVisibleStatus, normalizeInvoice, summarize, groupInvoices } from "./xero-helpers.mjs";

test("parseXeroDate handles Xero /Date()/ and ISO", () => {
  assert.equal(parseXeroDate("/Date(1782864000000+0000)/"), "2026-07-01");
  assert.equal(parseXeroDate("2026-07-01T00:00:00"), "2026-07-01");
  assert.equal(parseXeroDate(null), null);
});

test("isVisibleStatus only AUTHORISED/PAID", () => {
  assert.equal(isVisibleStatus("AUTHORISED"), true);
  assert.equal(isVisibleStatus("PAID"), true);
  assert.equal(isVisibleStatus("DRAFT"), false);
  assert.equal(isVisibleStatus("VOIDED"), false);
});

test("normalizeInvoice maps Xero fields", () => {
  const n = normalizeInvoice({
    InvoiceID: "abc", InvoiceNumber: "INV-2766", Status: "AUTHORISED",
    Date: "/Date(1782777600000+0000)/", DueDate: "/Date(1782864000000+0000)/",
    Total: 50361.95, AmountDue: 50361.95, AmountPaid: 0, CurrencyCode: "ZAR",
  }, "invoice");
  assert.equal(n.xero_invoice_id, "abc");
  assert.equal(n.number, "INV-2766");
  assert.equal(n.due_date, "2026-07-01");
  assert.equal(n.amount_due, 50361.95);
});

test("summarize totals outstanding + overdue", () => {
  const inv = [
    normalizeInvoice({ InvoiceID: "1", Status: "AUTHORISED", DueDate: "/Date(1782950400000+0000)/", Total: 100, AmountDue: 100, AmountPaid: 0, CurrencyCode: "ZAR" }, "invoice"),
    normalizeInvoice({ InvoiceID: "2", Status: "PAID", DueDate: "/Date(1782950400000+0000)/", Total: 50, AmountDue: 0, AmountPaid: 50, CurrencyCode: "ZAR" }, "invoice"),
    normalizeInvoice({ InvoiceID: "3", Status: "AUTHORISED", DueDate: "/Date(1577836800000+0000)/", Total: 30, AmountDue: 30, AmountPaid: 0, CurrencyCode: "ZAR" }, "invoice"),
  ];
  const s = summarize(inv, "2026-06-30");
  assert.equal(s.outstanding, 130);   // 100 + 30 still due
  assert.equal(s.overdue, 30);        // only #3 is past due (2020 date)
  assert.equal(s.currency, "ZAR");
});

test("groupInvoices splits open / paid / credit notes", () => {
  const inv = [
    { type: "invoice", status: "AUTHORISED", amount_due: 100 },
    { type: "invoice", status: "PAID", amount_due: 0 },
    { type: "credit_note", status: "PAID", amount_due: 0 },
  ];
  const g = groupInvoices(inv);
  assert.equal(g.open.length, 1);
  assert.equal(g.paid.length, 1);
  assert.equal(g.creditNotes.length, 1);
});
