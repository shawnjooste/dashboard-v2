// The one door every portal email goes through: sends via Resend, then
// records the message in sent_emails so /communications and the admin
// activity feed have a complete history. If you add a new email anywhere,
// call THIS — a send that bypasses it is invisible to the client's history.
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

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
export async function sendEmail(opts: SendEmailOptions): Promise<{ id: string | null }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set — skipping email:", opts.subject);
    return { id: null };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: opts.from ?? DEFAULT_FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
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
        to_emails: [...opts.to, ...(opts.cc ?? [])].map((e) => e.trim().toLowerCase()),
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
  return { id };
}
