// Payment receipts for quote checkout + recurring charges. One receipt per
// SUCCESSFUL charge, sent to the payer and copied to accounts@rocking.one.
// Callers only invoke this after winning the atomic paid-flip, which is what
// guarantees exactly one receipt per payment (webhook/verify/cron can all
// race — only the flip winner sends).
//
// This is a payment receipt, not a tax invoice — invoicing lives in Xero.
import "server-only";
import { sendEmail } from "@/lib/email/send";

const ACCOUNTS_EMAIL = "accounts@rocking.one";
const FROM = '"Rocking" <no-reply@send.rocking.one>';

const fmtR = (cents: number) =>
  "R " + (cents / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function sendPaymentReceipt(opts: {
  clientId: string;
  clientName: string;
  toEmail: string;
  quoteNumber: string;
  quoteTitle: string;
  /** What was paid for, e.g. "Once-off installation + pro-rata (7–31 Aug 2026)". */
  description: string;
  exVatCents: number;
  vatCents: number;
  reference: string;
  paidAt: Date;
}): Promise<void> {
  const totalCents = opts.exVatCents + opts.vatCents;
  const date = opts.paidAt.toISOString().slice(0, 10);
  const subject = `Receipt — ${fmtR(totalCents)} received for ${opts.quoteNumber}`;
  const row = (label: string, value: string, strong = false) => `
    <tr>
      <td style="padding:6px 16px 6px 0; color:#71717A; font-size:13.5px;">${label}</td>
      <td style="padding:6px 0; text-align:right; font-size:13.5px; ${strong ? "font-weight:bold; color:#18181B;" : "color:#3f3f46;"}">${value}</td>
    </tr>`;

  await sendEmail({
    from: FROM,
    replyTo: ACCOUNTS_EMAIL,
    to: [opts.toEmail],
    cc: [ACCOUNTS_EMAIL],
    subject,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 540px;">
        <h2 style="margin:0 0 4px;">Payment received — thank you</h2>
        <p style="color:#71717A; margin:0 0 18px; font-size:13px;">
          Rocking (Pty) Ltd · VAT No 4810312173 · Reg 2013/047237/07
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; border-top:1px solid #E4E4E7; border-bottom:1px solid #E4E4E7;">
          ${row("Date", date)}
          ${row("Received from", `${opts.clientName}`)}
          ${row("For", `${opts.quoteNumber} — ${opts.quoteTitle}`)}
          ${row("Details", opts.description)}
          ${row("Amount (ex VAT)", fmtR(opts.exVatCents))}
          ${row("VAT (15%)", fmtR(opts.vatCents))}
          ${row("Total paid", fmtR(totalCents), true)}
          ${row("Payment method", "Card (Paystack)")}
          ${row("Reference", opts.reference)}
        </table>
        <p style="color:#71717A; margin:16px 0 0; font-size:12.5px;">
          This is a payment receipt. If you need a tax invoice, reply to this email and our accounts
          team will send one.
        </p>
      </div>`,
    clientId: opts.clientId,
    category: "receipt",
    audience: "client",
  });
}
