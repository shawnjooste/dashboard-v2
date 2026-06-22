// Job notifications via Resend. Best-effort: a failed email never blocks the
// job action. Recipients = active managers of the job's client. Returns the
// number of recipients (stored on job_updates.emailed_count).
import { createServiceClient } from "@/lib/supabase/service";

const FROM = '"Rocking" <no-reply@send.rocking.one>';

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

/** Job opened → active managers. Returns the recipient count. */
export async function notifyJobOpened(opts: { clientId: string; title: string }): Promise<number> {
  const to = await managerEmails(opts.clientId);
  if (to.length === 0) return 0;
  await sendEmail(
    to,
    `We've started work — ${opts.title}`,
    wrap(`
      <h2 style="margin:0 0 8px;">We're on it</h2>
      <p style="color:#444; margin:0;">Rocking has opened a job for you: <strong>${opts.title}</strong>. We'll let you know as it progresses, and when it's done.</p>
    `),
  );
  return to.length;
}

/** Job completed → active managers. Returns the recipient count. */
export async function notifyJobCompleted(opts: { clientId: string; title: string }): Promise<number> {
  const to = await managerEmails(opts.clientId);
  if (to.length === 0) return 0;
  await sendEmail(
    to,
    `Completed — ${opts.title}`,
    wrap(`
      <h2 style="margin:0 0 8px;">All done</h2>
      <p style="color:#444; margin:0;"><strong>${opts.title}</strong> is complete. Thanks — reach out any time if you need anything else.</p>
    `),
  );
  return to.length;
}

/** Manual "Post update" → active managers. Returns the recipient count. */
export async function notifyJobUpdate(opts: { clientId: string; title: string; body: string }): Promise<number> {
  const to = await managerEmails(opts.clientId);
  if (to.length === 0) return 0;
  await sendEmail(
    to,
    `Update — ${opts.title}`,
    wrap(`
      <h2 style="margin:0 0 8px;">An update on your job</h2>
      <p style="color:#444; margin:0 0 4px;"><strong>${opts.title}</strong></p>
      <p style="color:#444; margin:0; white-space:pre-wrap;">${opts.body}</p>
    `),
  );
  return to.length;
}
