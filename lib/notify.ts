// Server-only email notifications via Resend (the same domain used for auth).
// Sending itself lives in lib/email/send.ts — the single chokepoint that also
// records every message in sent_emails for /communications.
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { onboardingEmailHtml, type OnboardingFeature } from "@/lib/onboarding-email";
import type { DetailChange } from "@/lib/company-details-helpers";

const ADMIN_EMAIL = "shawn@rocking.one";
const SUPPORT_EMAIL = "support@rocking.co.za"; // FreeScout helpdesk inbox — replies land as tickets
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

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
    audience: "internal",
    to: [ADMIN_EMAIL],
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
    audience: "client",
    clientId: opts.clientId,
    to: [opts.to],
    subject: `Welcome to The Portal — ${opts.companyName}`,
    html: onboardingEmailHtml(opts),
    // The sent copy carries a one-click sign-in link — a bearer credential.
    // Managers can read every client-audience row for their company, so the
    // stored copy points at the normal login page instead; without this a
    // manager could open a colleague's invite and sign in as them.
    recordHtml: onboardingEmailHtml({
      ...opts,
      portalUrl: `${APP_URL}/login`,
      supportNote: opts.supportNote,
      ctaLabel: "Go to the portal",
    }),
    replyTo: SUPPORT_EMAIL,
  });
}

/** Booking-paid confirmation. Reply-to is the helpdesk, so "need to
 *  reschedule? just reply" lands as a FreeScout ticket. */
export async function sendBookingConfirmation(opts: {
  to: string;
  serviceName: string;
  slotLabel: string;
  totalCents: number;
  reference: string;
  clientId: string | null;
}): Promise<void> {
  const rands = `R ${(opts.totalCents / 100).toFixed(2).replace(".", ",")}`;
  await sendEmail({
    to: [opts.to],
    subject: `Booking confirmed — ${opts.serviceName}, ${opts.slotLabel}`,
    replyTo: SUPPORT_EMAIL,
    category: "booking",
    audience: "client",
    clientId: opts.clientId,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1a1a;">
        <h2 style="margin:0 0 8px;">You're booked in</h2>
        <p style="color:#444;margin:0 0 16px;">
          Your <strong>${opts.serviceName}</strong> is confirmed for <strong>${opts.slotLabel}</strong>.
          Paid: <strong>${rands}</strong> (ref ${opts.reference}).
        </p>
        <p style="color:#444;margin:0 0 16px;">
          One of our engineers will be in touch at the booked time. Need to reschedule?
          Just reply to this email and we'll sort it out.
        </p>
        <p style="color:#888;margin:16px 0 0;font-size:13px;">&mdash; The Rocking team</p>
      </div>`,
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
    audience: "internal",
    clientId: data.client_id,
    to: [ADMIN_EMAIL],
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

const ACCOUNTS_EMAIL = "accounts@rocking.one";

/**
 * Tells accounts a client corrected their own company details. This is the
 * trigger for a human to mirror the change into Xero — the portal is the
 * client's record, Xero remains the billing system, and nothing syncs back
 * automatically. Internal audience: it must never appear in the client's own
 * communications history.
 */
export async function sendCompanyDetailsChanged(opts: {
  clientId: string;
  clientName: string;
  changedBy: string;
  changes: DetailChange[];
}): Promise<void> {
  if (!opts.changes.length) return;

  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const cell = (v: string | null) =>
    v === null ? '<span style="color:#A1A1AA;">(empty)</span>' : esc(v);

  const rows = opts.changes
    .map(
      (c) => `<tr>
        <td style="padding:6px 12px 6px 0; font-weight:bold; color:#18181B;">${esc(c.label)}</td>
        <td style="padding:6px 12px 6px 0; color:#71717A;">${cell(c.oldValue)}</td>
        <td style="padding:6px 0; color:#18181B;">${cell(c.newValue)}</td>
      </tr>`,
    )
    .join("");

  const when = new Date().toLocaleString("en-ZA", { dateStyle: "long", timeStyle: "short" });

  await sendEmail({
    to: [ACCOUNTS_EMAIL],
    subject: `Company details updated — ${opts.clientName}`,
    clientId: opts.clientId,
    category: "admin_alert",
    audience: "internal",
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif; max-width:640px; color:#18181B;">
      <h2 style="margin:0 0 4px; font-size:18px;">Company details updated</h2>
      <p style="margin:0 0 16px; color:#52525B; font-size:14px;">
        <strong>${esc(opts.clientName)}</strong> — changed by ${esc(opts.changedBy)} on ${esc(when)}.
      </p>
      <table style="border-collapse:collapse; font-size:14px;">
        <tr style="text-align:left; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:#A1A1AA;">
          <th style="padding:0 12px 6px 0;">Field</th>
          <th style="padding:0 12px 6px 0;">Was</th>
          <th style="padding:0 0 6px;">Now</th>
        </tr>
        ${rows}
      </table>
      <p style="margin:16px 0 0; color:#71717A; font-size:13px;">
        Update Xero to match if this affects invoicing.
      </p>
    </div>`,
  });
}

/**
 * Tells a client's managers an agreement is waiting for signature. Client
 * audience — this lands in their communications history, which is exactly
 * where a "you were asked to sign this" record belongs.
 */
export async function sendAgreementForSignature(opts: {
  to: string[];
  reference: string;
  title: string;
  companyName: string;
  agreementId: string;
  clientId: string | null;
}): Promise<void> {
  if (!opts.to.length) return;
  const url = `${APP_URL}/agreements/${opts.agreementId}`;
  await sendEmail({
    to: opts.to,
    subject: `Please review and sign: ${opts.title}`,
    replyTo: SUPPORT_EMAIL,
    category: "agreement",
    audience: "client",
    clientId: opts.clientId,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1a1a;">
        <h2 style="margin:0 0 8px;">An agreement is ready for you</h2>
        <p style="color:#444;margin:0 0 16px;">
          We've prepared <strong>${opts.title}</strong> for ${opts.companyName}.
          You can read it in the portal and sign it there — no printing or scanning.
        </p>
        <p style="margin:20px 0 0;">
          <a href="${url}" style="background:#D7141C;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600;">
            Read and sign
          </a>
        </p>
        <p style="color:#666;margin:20px 0 0;font-size:13px;">
          Reference ${opts.reference}. Once signed you can download a PDF copy, and the
          agreement stays available in the portal.
        </p>
      </div>`,
  });
}

/** Tells Rocking an agreement was signed. Internal — never shown to clients. */
export async function notifyAgreementSigned(opts: {
  reference: string;
  title: string;
  companyName: string;
  signerName: string;
  signerEmail: string;
  agreementId: string;
  clientId: string | null;
}): Promise<void> {
  await sendEmail({
    to: [ADMIN_EMAIL],
    subject: `Signed: ${opts.title} — ${opts.companyName}`,
    category: "agreement",
    audience: "internal",
    clientId: opts.clientId,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1a1a;">
        <h2 style="margin:0 0 8px;">${opts.title} has been signed</h2>
        <table style="font-size:14px;color:#111;">
          <tr><td style="color:#888;padding-right:12px;">Company</td><td><strong>${opts.companyName}</strong></td></tr>
          <tr><td style="color:#888;padding-right:12px;">Signed by</td><td>${opts.signerName} (${opts.signerEmail})</td></tr>
          <tr><td style="color:#888;padding-right:12px;">Reference</td><td>${opts.reference}</td></tr>
        </table>
        <p style="margin:20px 0 0;">
          <a href="${APP_URL}/admin/agreements/${opts.agreementId}" style="background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;">
            Open the agreement
          </a>
        </p>
      </div>`,
  });
}
