// Server-only email notifications via Resend (the same domain used for auth).
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

const FROM = '"Rocking" <no-reply@send.rocking.one>';
const ADMIN_EMAIL = "shawn@rocking.one";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://dashboard-v2-blue.vercel.app";

async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("RESEND_API_KEY not set — skipping email:", opts.subject);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: opts.to, subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) throw new Error(`Resend send failed (${res.status})`);
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
