// Job notifications via Resend. Best-effort: a failed email never blocks the
// job action. Recipients = active managers of the job's client. Returns the
// number of recipients (stored on job_updates.emailed_count).
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail as send } from "@/lib/email/send";
import {
  greetingName,
  assigneeGreetingName,
  assignmentEmailContent,
  type PersonName,
  type AssigneeKind,
} from "@/lib/job-email-helpers";

const FROM = '"Rocking" <no-reply@send.rocking.one>';

type ManagerRecipient = { email: string; name: string };

/** Sends via the shared chokepoint (which records it for /communications).
 *  BCC still goes out but is deliberately never recorded — blind stays blind. */
async function sendEmail(
  to: string[],
  subject: string,
  html: string,
  bcc?: string[],
  opts?: { clientId?: string | null; audience?: "client" | "internal" },
): Promise<void> {
  await send({
    to,
    bcc,
    subject,
    html,
    from: FROM,
    category: "job",
    audience: opts?.audience ?? "client",
    clientId: opts?.clientId ?? null,
  });
}

/** The job owner's email (for BCC), or null when there's no owner / no row. */
async function ownerEmail(ownerProfileId: string | null | undefined): Promise<string | null> {
  if (!ownerProfileId) return null;
  const service = createServiceClient();
  const { data } = await service.from("profiles").select("email").eq("id", ownerProfileId).maybeSingle();
  return data?.email ?? null;
}

/** Owner address to BCC, unless it's already one of the `to` recipients (case-insensitive). */
function ownerBcc(owner: string | null, to: string[]): string[] | undefined {
  if (!owner) return undefined;
  const lower = owner.toLowerCase();
  if (to.some((e) => e.toLowerCase() === lower)) return undefined;
  return [owner];
}

/** Active managers of a client, each with a first-name greeting for personalised mail. */
async function managerRecipients(clientId: string): Promise<ManagerRecipient[]> {
  const service = createServiceClient();
  const { data } = await service
    .from("profiles")
    .select("email, people:person_id(first_name, display_name)")
    .eq("client_id", clientId)
    .eq("role", "client_manager")
    .eq("status", "active");
  return (data ?? []).map((p) => {
    const person = (Array.isArray(p.people) ? p.people[0] : p.people) as PersonName;
    return { email: p.email, name: greetingName(person) };
  });
}

const wrap = (body: string) => `
  <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px;">
    ${body}
  </div>`;

/** Job opened → active managers, each greeted by first name. Owner BCC'd once. Returns the number sent. */
export async function notifyJobOpened(opts: { clientId: string; title: string; ownerProfileId?: string | null }): Promise<number> {
  const recipients = await managerRecipients(opts.clientId);
  const owner = await ownerEmail(opts.ownerProfileId);
  const bcc = ownerBcc(owner, recipients.map((r) => r.email));
  let sent = 0;
  for (const [i, r] of recipients.entries()) {
    try {
      await sendEmail(
        [r.email],
        `We've started work — ${opts.title}`,
        wrap(`
      <p style="color:#444; margin:0 0 14px;">Hi ${r.name},</p>
      <h2 style="margin:0 0 8px;">We're on it</h2>
      <p style="color:#444; margin:0;">Rocking has opened a job for you: <strong>${opts.title}</strong>. We'll keep you posted on how it progresses.</p>
    `),
        i === 0 ? bcc : undefined, // owner copy rides the first send only
        { clientId: opts.clientId, audience: "client" },
      );
      sent++;
    } catch (e) {
      console.error("job opened email failed for", r.email, e);
    }
  }
  return sent;
}

/** Job completed → active managers, owner BCC'd. Returns the recipient count. */
export async function notifyJobCompleted(opts: { clientId: string; title: string; ownerProfileId?: string | null }): Promise<number> {
  const to = (await managerRecipients(opts.clientId)).map((r) => r.email);
  if (to.length === 0) return 0;
  const bcc = ownerBcc(await ownerEmail(opts.ownerProfileId), to);
  await sendEmail(
    to,
    `Completed — ${opts.title}`,
    wrap(`
      <h2 style="margin:0 0 8px;">All done</h2>
      <p style="color:#444; margin:0;"><strong>${opts.title}</strong> is complete. Thanks — reach out any time if you need anything else.</p>
    `),
    bcc,
    { clientId: opts.clientId, audience: "client" },
  );
  return to.length;
}

/** Manual "Post update" → active managers, owner BCC'd. Returns the recipient count. */
export async function notifyJobUpdate(opts: { clientId: string; title: string; body: string; ownerProfileId?: string | null }): Promise<number> {
  const to = (await managerRecipients(opts.clientId)).map((r) => r.email);
  if (to.length === 0) return 0;
  const bcc = ownerBcc(await ownerEmail(opts.ownerProfileId), to);
  await sendEmail(
    to,
    `Update — ${opts.title}`,
    wrap(`
      <h2 style="margin:0 0 8px;">An update on your job</h2>
      <p style="color:#444; margin:0 0 4px;"><strong>${opts.title}</strong></p>
      <p style="color:#444; margin:0; white-space:pre-wrap;">${opts.body}</p>
    `),
    bcc,
    { clientId: opts.clientId, audience: "client" },
  );
  return to.length;
}

/**
 * Task assigned → the assignee (two tones, by kind). Owner BCC'd unless they're
 * the assignee. Returns 1 if a send was attempted, else 0.
 */
export async function notifyTaskAssigned(opts: {
  assignee: { email: string; kind: AssigneeKind; person: PersonName };
  jobTitle: string;
  taskLabel: string;
  ownerEmail?: string | null;
}): Promise<number> {
  const name = assigneeGreetingName({ kind: opts.assignee.kind, email: opts.assignee.email, person: opts.assignee.person });
  const { subject, body } = assignmentEmailContent({ kind: opts.assignee.kind, name, jobTitle: opts.jobTitle, taskLabel: opts.taskLabel });
  const bcc = ownerBcc(opts.ownerEmail ?? null, [opts.assignee.email]);
  await sendEmail([opts.assignee.email], subject, wrap(body), bcc, { audience: "internal" });
  return 1;
}

/** Weekly open-work digest → one staff member. Body is inner HTML from lib/job-digest. */
export async function sendJobDigest(to: string, subject: string, html: string): Promise<void> {
  await sendEmail([to], subject, wrap(html), undefined, { audience: "internal" });
}
