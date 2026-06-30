// Pure Xero billing helpers — no I/O, shared by the pull (.mjs) and the view (.ts).

export const VISIBLE_STATUSES = ["AUTHORISED", "PAID"];
export const isVisibleStatus = (s) => VISIBLE_STATUSES.includes(s);

/** Xero returns "/Date(ms+zone)/"; newer payloads ISO. -> YYYY-MM-DD or null. */
export function parseXeroDate(s) {
  if (!s) return null;
  // Xero legacy: /Date(ms+zone)/
  const m = /\/Date\((\d+)/.exec(s);
  if (m) {
    const ms = Number(m[1]);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString().slice(0, 10);
  }
  // ISO string: extract date component directly (timezone-safe).
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  return null;
}

const num = (v) => (v == null ? null : Number(v));

export function normalizeInvoice(raw, type) {
  return {
    xero_invoice_id: raw.InvoiceID ?? raw.CreditNoteID,
    number: raw.InvoiceNumber ?? raw.CreditNoteNumber ?? null,
    type, // 'invoice' | 'credit_note'
    status: raw.Status,
    date: parseXeroDate(raw.Date),
    due_date: parseXeroDate(raw.DueDate),
    total: num(raw.Total),
    amount_due: num(raw.AmountDue),
    amount_paid: num(raw.AmountPaid),
    currency: raw.CurrencyCode ?? null,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

export function summarize(invoices, todayIso) {
  let outstanding = 0, overdue = 0, openCount = 0, currency = null;
  for (const i of invoices) {
    if (i.type !== "invoice") continue;
    const due = i.amount_due ?? 0;
    if (due > 0) {
      outstanding += due;
      openCount += 1;
      if (i.due_date && i.due_date < todayIso) overdue += due;
      currency = currency ?? i.currency;
    }
  }
  return { outstanding: round2(outstanding), overdue: round2(overdue), currency, openCount };
}

export function groupInvoices(invoices) {
  const open = [], paid = [], creditNotes = [];
  for (const i of invoices) {
    if (i.type === "credit_note") creditNotes.push(i);
    else if ((i.amount_due ?? 0) > 0) open.push(i);
    else paid.push(i);
  }
  return { open, paid, creditNotes };
}
