// Quote notifications via Resend. Best-effort: a failed email never blocks the
// quote action — quote_events is the source of truth.
import { createServiceClient } from "@/lib/supabase/service";

const FROM = '"Rocking" <no-reply@send.rocking.one>';
const ADMIN_EMAIL = "shawn@rocking.one";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

async function sendEmail(to: string[], subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set — skipping email:", subject);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend send failed (${res.status})`);
}

async function managerEmails(clientId: string): Promise<string[]> {
  const service = createServiceClient();
  const { data } = await service
    .from("profiles")
    .select("email")
    .eq("client_id", clientId)
    .eq("role", "client_manager")
    .eq("status", "active");
  return (data ?? []).map((p) => p.email);
}

const wrap = (body: string) => `
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px;">
    ${body}
  </div>`;

const button = (href: string, label: string) => `
  <p style="margin:20px 0 0;">
    <a href="${href}" style="background:#D7141C; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">
      ${label}
    </a>
  </p>`;

/** New quote (or new version) → every active manager at the client. */
export async function notifyQuoteSent(opts: {
  clientId: string;
  quoteId: string;
  quoteNumber: string;
  title: string;
  grandTotal: string;
  isRevision: boolean;
}): Promise<void> {
  const to = await managerEmails(opts.clientId);
  if (to.length === 0) {
    console.warn("notifyQuoteSent: no active managers for client", opts.clientId);
    return;
  }
  const heading = opts.isRevision
    ? `Updated quote from Rocking — ${opts.quoteNumber}`
    : `New quote from Rocking — ${opts.quoteNumber}`;
  await sendEmail(
    to,
    `${heading}: ${opts.title}`,
    wrap(`
      <h2 style="margin:0 0 8px;">${heading}</h2>
      <p style="color:#444; margin:0 0 16px;">
        ${opts.isRevision ? "We've revised a quote for you" : "We've prepared a quote for you"}:
        <strong>${opts.title}</strong> — ${opts.grandTotal} incl VAT.
        You can review it, print it, and accept or decline online.
      </p>
      ${button(`${APP_URL}/quotes/${opts.quoteId}`, "View the quote")}
    `),
  );
}

/** Decision (accept / decline / changes requested) → Shawn + all managers. */
export async function notifyQuoteDecision(opts: {
  clientId: string;
  quoteId: string;
  quoteNumber: string;
  title: string;
  decision: "accepted" | "rejected" | "changes_requested";
  actorEmail: string;
  comment: string | null;
}): Promise<void> {
  const managers = await managerEmails(opts.clientId);
  const to = [ADMIN_EMAIL, ...managers.filter((e) => e !== ADMIN_EMAIL)];
  const verb = {
    accepted: "accepted",
    rejected: "declined",
    changes_requested: "requested changes to",
  }[opts.decision];
  await sendEmail(
    to,
    `Quote ${opts.quoteNumber} ${opts.decision === "changes_requested" ? "— changes requested" : verb}`,
    wrap(`
      <h2 style="margin:0 0 8px;">Quote ${verb}</h2>
      <p style="color:#444; margin:0 0 16px;">
        <strong>${opts.actorEmail}</strong> ${verb} quote
        <strong>${opts.quoteNumber}</strong> (${opts.title}).
      </p>
      ${opts.comment ? `<p style="color:#444; border-left:3px solid #E4E4E7; padding-left:12px; margin:0 0 16px;">"${opts.comment}"</p>` : ""}
      ${button(`${APP_URL}/quotes/${opts.quoteId}`, "View the quote")}
    `),
  );
}
