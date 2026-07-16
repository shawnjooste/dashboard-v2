// Server-only email notifications via Resend (the same domain used for auth).
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { onboardingEmailHtml, type OnboardingFeature } from "@/lib/onboarding-email";

const FROM = '"Rocking" <no-reply@send.rocking.one>';
const ADMIN_EMAIL = "shawn@rocking.one";
const SUPPORT_EMAIL = "support@rocking.co.za"; // FreeScout helpdesk inbox — replies land as tickets
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  /** Activity-feed category, e.g. "onboarding" | "admin_alert". */
  category?: string;
  /** Client the email relates to, when known — shown in the activity feed. */
  clientId?: string | null;
}): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set — skipping email:", opts.subject);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed (${res.status})`);
  // Log the send to the activity feed. Best-effort: never fail the email.
  try {
    await createServiceClient().from("portal_activity").insert({
      kind: "email",
      section: opts.category ?? "general",
      detail: `“${opts.subject}” → ${opts.to}`.slice(0, 200),
      client_id: opts.clientId ?? null,
    });
  } catch (e) {
    console.error("email activity log failed:", e);
  }
}

/**
 * Emails staff when a user lands in the pending-approval queue. Idempotent:
 * an atomic claim on pending_notified_at ensures exactly one email per signup,
 * even across concurrent requests. Best-effort — callers should not let a
 * notification failure block the auth flow.
 */
export async function notifyPendingSignup(userId: string): Promise<void> {
  const service = createServiceClient();
  // Atomically claim the notification: only the row that is still pending and
  // not yet notified is updated, and only one caller can win.
  const { data } = await service
    .from("profiles")
    .update({ pending_notified_at: new Date().toISOString() })
    .eq("id", userId)
    .eq("status", "pending")
    .is("pending_notified_at", null)
    .select("email, created_at")
    .maybeSingle();

  if (!data) return; // not pending, or already notified by another request

  const domain = data.email.split("@")[1] ?? "";
  await sendEmail({
    category: "admin_alert",
    to: ADMIN_EMAIL,
    subject: `New signup pending approval — ${data.email}`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px;">
        <h2 style="margin:0 0 8px;">New signup pending approval</h2>
        <p style="color:#444; margin:0 0 16px;">
          Someone signed in with an email whose domain (<strong>${domain}</strong>) isn't linked
          to a client, so they're waiting in the approvals queue.
        </p>
        <table style="font-size:14px; color:#111;">
          <tr><td style="color:#888; padding-right:12px;">Email</td><td><strong>${data.email}</strong></td></tr>
          <tr><td style="color:#888; padding-right:12px;">Signed up</td><td>${data.created_at}</td></tr>
        </table>
        <p style="margin:20px 0 0;">
          <a href="${APP_URL}/admin/pending" style="background:#111; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">
            Review in approvals
          </a>
        </p>
      </div>`,
  });
}

/**
 * Sends the branded "welcome to The Portal" onboarding email. Throws on a send
 * failure so the caller (invite flow) can surface it. No idempotency guard — the
 * caller decides when to send (an explicit invite), unlike the auto notifiers.
 */
export async function sendOnboardingEmail(opts: {
  to: string;
  firstName: string;
  companyName: string;
  portalUrl: string;
  clientId?: string | null;
  intro?: string;
  eyebrow?: string;
  features?: OnboardingFeature[];
  preheader?: string;
  supportNote?: string | null;
}): Promise<void> {
  await sendEmail({
    category: "onboarding",
    clientId: opts.clientId,
    to: opts.to,
    subject: `Welcome to The Portal — ${opts.companyName}`,
    html: onboardingEmailHtml(opts),
    replyTo: SUPPORT_EMAIL,
  });
}

const ROLE_LABEL: Record<string, string> = {
  client_manager: "Manager",
  client_member: "Member",
  rocking_staff: "Rocking staff",
};

/**
 * Emails staff the first time a user ever signs in, so they can act on the new
 * arrival (e.g. promote them to manager). Idempotent: an atomic claim on
 * first_signin_notified_at sends exactly one email per user, even across
 * concurrent requests. Best-effort — never let it block sign-in.
 */
export async function notifyFirstSignIn(userId: string): Promise<void> {
  const service = createServiceClient();
  const { data } = await service
    .from("profiles")
    .update({ first_signin_notified_at: new Date().toISOString() })
    .eq("id", userId)
    .is("first_signin_notified_at", null)
    .select("email, client_id, role, person_id")
    .maybeSingle();

  if (!data) return; // already notified by an earlier sign-in

  // Best-effort niceties: a display name and client name for the email.
  let name = data.email;
  if (data.person_id) {
    const { data: person } = await service
      .from("people")
      .select("display_name")
      .eq("id", data.person_id)
      .maybeSingle();
    if (person?.display_name) name = person.display_name;
  }
  let clientName: string | null = null;
  if (data.client_id) {
    const { data: client } = await service
      .from("clients")
      .select("name")
      .eq("id", data.client_id)
      .maybeSingle();
    clientName = client?.name ?? null;
  }

  const role = ROLE_LABEL[data.role] ?? data.role;
  const usersUrl = data.client_id
    ? `${APP_URL}/admin/users?client=${data.client_id}`
    : `${APP_URL}/admin/users`;

  await sendEmail({
    category: "admin_alert",
    clientId: data.client_id,
    to: ADMIN_EMAIL,
    subject: `First sign-in — ${name}${clientName ? ` (${clientName})` : ""}`,
    html: `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px;">
        <h2 style="margin:0 0 8px;">${name} just signed in for the first time</h2>
        <p style="color:#444; margin:0 0 16px;">
          They're now in the portal. If they should run the account, you can make them a manager.
        </p>
        <table style="font-size:14px; color:#111;">
          <tr><td style="color:#888; padding-right:12px;">Name</td><td><strong>${name}</strong></td></tr>
          <tr><td style="color:#888; padding-right:12px;">Email</td><td>${data.email}</td></tr>
          ${clientName ? `<tr><td style="color:#888; padding-right:12px;">Client</td><td>${clientName}</td></tr>` : ""}
          <tr><td style="color:#888; padding-right:12px;">Current role</td><td>${role}</td></tr>
        </table>
        <p style="margin:20px 0 0;">
          <a href="${usersUrl}" style="background:#111; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">
            Open in users
          </a>
        </p>
      </div>`,
  });
}
