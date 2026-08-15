// Quote notifications via Resend. Best-effort: a failed email never blocks the
// quote action — quote_events is the source of truth. Sending goes through
// lib/email/send.ts (which also records the message for /communications);
// quote mail keeps its own FROM because quotes@ is the inbound-reply address.
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail as send } from "@/lib/email/send";

const FROM = '"Rocky @ Rocking" <quotes@send.rocking.one>';
const ADMIN_EMAIL = "shawn@rocking.one";
// Standing rule (2026-08-05): accounts@ is copied on ALL quote-related email.
const ACCOUNTS_EMAIL = "accounts@rocking.one";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

/** Sends as quotes@ and returns the threading header Resend replies carry
 *  (`<id@send.rocking.one>`), or null when the send was skipped. */
async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  cc?: string[],
  opts?: { clientId?: string | null; audience?: "client" | "internal" },
): Promise<string | null> {
  const { id } = await send({
    to,
    cc,
    subject,
    html,
    from: FROM,
    category: "quote",
    audience: opts?.audience ?? "client",
    clientId: opts?.clientId ?? null,
  });
  return id ? `<${id}@send.rocking.one>` : null;
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
    <p style="margin:24px 0 0; color:#888; font-size:12.5px;">— Rocky</p>
  </div>`;

const button = (href: string, label: string) => `
  <p style="margin:20px 0 0;">
    <a href="${href}" style="background:#D7141C; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">
      ${label}
    </a>
  </p>`;

/** First time a manager opens a quote → Shawn. */
export async function notifyQuoteViewed(opts: {
  quoteId: string;
  quoteNumber: string;
  title: string;
  clientName: string;
  viewerEmail: string;
}): Promise<void> {
  await sendEmail(
    [ADMIN_EMAIL],
    `Quote ${opts.quoteNumber} viewed by ${opts.clientName}`,
    wrap(`
      <h2 style="margin:0 0 8px;">Quote viewed</h2>
      <p style="color:#444; margin:0 0 16px;">
        <strong>${opts.viewerEmail}</strong> opened quote
        <strong>${opts.quoteNumber}</strong> (${opts.title}) for <strong>${opts.clientName}</strong>.
      </p>
      ${button(`${APP_URL}/admin/quotes/${opts.quoteId}`, "View in admin")}
    `),
    [ACCOUNTS_EMAIL],
    { audience: "internal" },
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
    [ACCOUNTS_EMAIL],
    { clientId: opts.clientId, audience: "client" },
  );
}
