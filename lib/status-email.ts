// Status emails. One message PER RECIPIENT — never a shared `to:` array,
// which would leak client addresses to each other and misfile the
// sent_emails record (it carries a single client_id).
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { resolveRecipients, subjectFor, TYPE_LABELS, type Subscriber } from "@/lib/status-helpers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";
const SUPPORT_EMAIL = "support@rocking.co.za";

/** Escapes text destined for the HTML body — an incident title or update can
 *  contain anything an admin types mid-crisis. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function html(title: string, type: string, body: string, resolved: boolean): string {
  const heading = resolved ? "Resolved" : (TYPE_LABELS[type] ?? "Update");
  const tint = resolved
    ? "#15803D"
    : type === "outage"
      ? "#B91C1C"
      : type === "degraded"
        ? "#B45309"
        : "#185FA5";
  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1a1a;">
  <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:${tint};text-transform:uppercase;letter-spacing:.4px;">${esc(heading)}</p>
  <h2 style="margin:0 0 14px;font-size:19px;">${esc(title)}</h2>
  <p style="margin:0 0 18px;white-space:pre-wrap;color:#333;font-size:14px;line-height:1.5;">${esc(body)}</p>
  <a href="${APP_URL}/status" style="display:inline-block;background:#D7141C;color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:8px;font-size:14px;">View status page</a>
  <p style="color:#888;margin:18px 0 0;font-size:12px;">You're receiving this because you turned on status updates. You can turn them off on the status page.</p>
</div>`;
}

/** Emails everyone subscribed who can see this incident. Best-effort: a send
 *  failure is logged, never thrown — communicating during an outage must not
 *  depend on the mailer being healthy. */
export async function notifyIncident(
  incidentId: string,
  updateBody: string,
  opts: { resolved?: boolean } = {},
): Promise<{ sent: number; failed: number }> {
  const service = createServiceClient();
  const counts = { sent: 0, failed: 0 };
  try {
    const [{ data: incident }, { data: targets }, { data: subRows }] = await Promise.all([
      service.from("status_incidents").select("title, type, scope").eq("id", incidentId).maybeSingle(),
      service.from("status_incident_clients").select("client_id").eq("incident_id", incidentId),
      service.from("status_subscriptions").select("profile_id"),
    ]);
    if (!incident) return counts;

    const ids = (subRows ?? []).map((s) => s.profile_id);
    if (ids.length === 0) return counts;
    const { data: profiles } = await service
      .from("profiles")
      .select("id, email, client_id, role")
      .in("id", ids);

    const subs: Subscriber[] = (profiles ?? []).map((p) => ({
      profileId: p.id,
      email: p.email,
      clientId: p.client_id,
      role: p.role,
    }));
    const recipients = resolveRecipients(subs, {
      scope: incident.scope,
      clientIds: (targets ?? []).map((t) => t.client_id),
    });

    const subject = subjectFor(incident.title, incident.type, !!opts.resolved);
    const body = html(incident.title, incident.type, updateBody, !!opts.resolved);
    for (const r of recipients) {
      try {
        await sendEmail({
          to: [r.email],
          subject,
          html: body,
          replyTo: SUPPORT_EMAIL,
          clientId: r.clientId,
          category: "status",
        });
        counts.sent++;
      } catch (e) {
        counts.failed++;
        console.error(`status email to ${r.email} failed:`, e);
      }
    }
  } catch (e) {
    console.error("status notification failed:", e);
  }
  return counts;
}
