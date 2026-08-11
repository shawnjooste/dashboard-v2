// The one door every portal email goes through: sends via Resend, then
// records the message in sent_emails so /communications and the admin
// activity feed have a complete history. If you add a new email anywhere,
// call THIS — a send that bypasses it is invisible to the client's history.
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { isSuppressible, splitRecipients } from "@/lib/email/suppression";
import { portalUpdateFooterHtml } from "@/lib/email/portal-update-footer";

export const DEFAULT_FROM = '"Rocking" <no-reply@send.rocking.one>';

export type SendEmailOptions = {
  to: string[];
  subject: string;
  html: string;
  /** What to STORE, when it must differ from what was sent. Onboarding mail
   *  embeds a passwordless sign-in link: possession of that URL is
   *  authentication as the invitee, and managers can read every client-audience
   *  row for their company — so the recorded copy points at /login instead.
   *  Defaults to `html`. */
  recordHtml?: string;
  /** Overrides DEFAULT_FROM. Quote mail sends as quotes@ (the inbound-reply
   *  address) — changing a sender's from-address breaks reply threading. */
  from?: string;
  cc?: string[];
  /** Blind copies are never recorded on the client-visible row. */
  bcc?: string[];
  replyTo?: string;
  clientId?: string | null;
  /** Links supplier correspondence to its RFQ so the admin RFQ page can show
   *  the exchange as a thread. Always pair with audience:"internal" — these
   *  mails carry our cost prices. */
  rfqId?: string | null;
  /** onboarding | booking | quote | job | admin_alert | general */
  category?: string;
  /** "internal" = addressed to Rocking about a client; hidden from clients. */
  audience?: "client" | "internal";
  sentByProfileId?: string | null;
};

/** Sends the email and records it. Returns Resend's raw message id (callers
 *  that need a threading header format it themselves), or null when the send
 *  was skipped for want of an API key. Throws only if Resend rejects the send;
 *  a logging failure never propagates. */
export async function sendEmail(
  opts: SendEmailOptions,
): Promise<{ id: string | null; suppressed: string[] }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set — skipping email:", opts.subject);
    return { id: null, suppressed: [] };
  }

  // Honour Portal Update opt-outs here, at the one door every email goes
  // through — a hand-written script that forgets to filter still cannot reach
  // someone who switched these off. Transactional mail is never filtered.
  let to = opts.to;
  let suppressed: string[] = [];
  if (isSuppressible(opts.category)) {
    const lowered = opts.to.map((e) => e.trim().toLowerCase());
    const { data: outRows } = await createServiceClient()
      .from("profiles")
      .select("email")
      .eq("portal_updates_opt_out", true)
      .in("email", lowered);
    const optedOut = new Set((outRows ?? []).map((r) => r.email.trim().toLowerCase()));
    ({ send: to, suppressed } = splitRecipients(opts.to, opts.category, optedOut));
    // Everyone opted out: nothing was sent, so record nothing. A sent_emails
    // row here would show up in a client's history for mail they never got.
    if (to.length === 0) return { id: null, suppressed };
  }

  const html = isSuppressible(opts.category) ? opts.html + portalUpdateFooterHtml() : opts.html;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: opts.from ?? DEFAULT_FROM,
      to,
      subject: opts.subject,
      html,
      ...(opts.cc?.length ? { cc: opts.cc } : {}),
      ...(opts.bcc?.length ? { bcc: opts.bcc } : {}),
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed (${res.status})`);
  const sent = (await res.json().catch(() => ({}))) as { id?: string };
  const id: string | null = sent?.id ?? null;

  // Record it. Best-effort: the email is already gone, so a logging failure
  // must never surface to the caller.
  try {
    const { error } = await createServiceClient()
      .from("sent_emails")
      .insert({
        client_id: opts.clientId ?? null,
        rfq_id: opts.rfqId ?? null,
        // Addresses are lowercased so member visibility (which compares against
        // the lowercased current_user_email()) can never fail on casing.
        to_emails: [...to, ...(opts.cc ?? [])].map((e) => e.trim().toLowerCase()),
        subject: opts.subject,
        html: opts.recordHtml ?? opts.html,
        category: opts.category ?? "general",
        audience: opts.audience ?? "client",
        resend_id: id,
        sent_by_profile_id: opts.sentByProfileId ?? null,
      });
    if (error) console.error("sent_emails log failed:", error.message);
  } catch (e) {
    console.error("sent_emails log failed:", e);
  }
  return { id, suppressed };
}
