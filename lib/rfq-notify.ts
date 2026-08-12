// Email Shawn when something new lands in the RFQ world — a new inbound
// message at quotes@ or an RFQ created in the portal. Introduced when the
// automatic 15-min processing run was retired (2026-08-05): processing is now
// manual, so these mails are how new work gets noticed. Fail-soft everywhere —
// a notification must never break the webhook or the create action.
import "server-only";
import { sendEmail } from "@/lib/email/send";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";
const FROM = '"Rocky @ Rocking" <quotes@send.rocking.one>';
const ADMIN_EMAIL = "shawn@rocking.one";
const ACCOUNTS_EMAIL = "accounts@rocking.one";

const KIND_LABEL: Record<string, string> = {
  client_forward: "Forward to action",
  staff_supplier_request: "Staff → supplier (observed)",
  supplier_reply: "Supplier reply",
  client_quote_reply: "Client replied to a quote",
  supplier_clarification: "Supplier clarification",
  unclassified: "Unclassified",
};

const wrap = (body: string) => `
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 560px;">
    ${body}
    <p style="margin:24px 0 0; color:#888; font-size:12.5px;">— Rocky</p>
  </div>`;

const button = (href: string, label: string) => `
  <p style="margin:20px 0 0;">
    <a href="${href}" style="background:#D7141C; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">${label}</a>
  </p>`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function snippet(text: string | null): string {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "(no text body — open the portal to view)";
  return clean.length > 600 ? `${clean.slice(0, 600)}…` : clean;
}

/** New inbound message stored at quotes@ → tell Shawn what arrived, with the
 *  content, so he can decide whether to process it. Skipped when he sent it. */
export async function notifyInboundRfqEmail(opts: {
  kind: string;
  fromEmail: string;
  subject: string;
  textBody: string | null;
  rfqId: string | null;
  quoteId: string | null;
}): Promise<void> {
  if (opts.fromEmail.startsWith("shawn@")) return; // his own mail — no echo
  const link = opts.rfqId
    ? `${APP_URL}/admin/rfqs/${opts.rfqId}`
    : opts.quoteId
      ? `${APP_URL}/admin/quotes/${opts.quoteId}`
      : `${APP_URL}/admin/rfqs`;
  // Standing rule: accounts@ is CC'd on quote-related mail — except on the
  // notification about accounts@'s own message.
  const cc = opts.fromEmail.startsWith("accounts@") ? undefined : [ACCOUNTS_EMAIL];
  try {
    await sendEmail({
      from: FROM,
      to: [ADMIN_EMAIL],
      cc,
      subject: `RFQ inbox — ${KIND_LABEL[opts.kind] ?? opts.kind}: ${opts.subject || "(no subject)"}`,
      html: wrap(`
        <h2 style="margin:0 0 8px;">New mail at quotes@</h2>
        <p style="color:#444; margin:0 0 4px;"><strong>From:</strong> ${esc(opts.fromEmail)}</p>
        <p style="color:#444; margin:0 0 4px;"><strong>Type:</strong> ${KIND_LABEL[opts.kind] ?? opts.kind}</p>
        <p style="color:#444; margin:0 0 12px;"><strong>Subject:</strong> ${esc(opts.subject || "(no subject)")}</p>
        <p style="color:#444; border-left:3px solid #E4E4E7; padding-left:12px; margin:0 0 16px;">${esc(snippet(opts.textBody))}</p>
        ${button(link, "Open in the portal")}
      `),
      category: "quote",
      audience: "internal",
    });
  } catch (e) {
    console.error("inbound RFQ notification failed:", e);
  }
}

/** RFQ created in the portal → tell Shawn, unless he created it himself.
 *  Matched on his exact staff address, not a `shawn@` prefix: clients raise
 *  RFQs through this too (the Connectivity enquiry), and a customer contact
 *  who happens to be shawn@their-firm.co.za must still reach him. */
export async function notifyRfqCreated(opts: {
  rfqId: string;
  title: string;
  clientLabel: string | null;
  requestedBy: string | null;
  description: string | null;
  creatorEmail: string;
}): Promise<void> {
  if (opts.creatorEmail.toLowerCase() === ADMIN_EMAIL) return;
  const cc = opts.creatorEmail.toLowerCase() === ACCOUNTS_EMAIL ? undefined : [ACCOUNTS_EMAIL];
  try {
    await sendEmail({
      from: FROM,
      to: [ADMIN_EMAIL],
      cc,
      subject: `New RFQ — ${opts.title}`,
      html: wrap(`
        <h2 style="margin:0 0 8px;">New RFQ on the board</h2>
        <p style="color:#444; margin:0 0 4px;"><strong>${esc(opts.title)}</strong></p>
        ${opts.clientLabel ? `<p style="color:#444; margin:0 0 4px;"><strong>Client:</strong> ${esc(opts.clientLabel)}</p>` : ""}
        ${opts.requestedBy ? `<p style="color:#444; margin:0 0 4px;"><strong>Requested by:</strong> ${esc(opts.requestedBy)}</p>` : ""}
        <p style="color:#444; margin:0 0 4px;"><strong>Added by:</strong> ${esc(opts.creatorEmail)}</p>
        ${opts.description ? `<p style="color:#444; border-left:3px solid #E4E4E7; padding-left:12px; margin:12px 0 16px;">${esc(snippet(opts.description))}</p>` : ""}
        ${button(`${APP_URL}/admin/rfqs/${opts.rfqId}`, "Open the RFQ")}
      `),
      category: "quote",
      audience: "internal",
    });
  } catch (e) {
    console.error("RFQ-created notification failed:", e);
  }
}
