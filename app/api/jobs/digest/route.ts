import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { buildDigests, type DigestPerson } from "@/lib/job-digest";
import { toDateString } from "@/lib/job-board-helpers";
import { assigneeGreetingName } from "@/lib/job-email-helpers";
import { sendJobDigest } from "@/lib/job-emails";

/**
 * Weekly "your open work" digest for Rocking staff.
 *
 * Uses the service-role client on purpose: a scheduled invocation has no
 * signed-in user, so RLS-scoped reads would come back empty. Guarded by a shared
 * secret — the same `Authorization: Bearer <CRON_SECRET>` header Vercel Cron
 * sends, so the manual trigger and any future schedule hit the identical path.
 *
 * Recipients are active rocking_staff who own an open job or hold an incomplete
 * task on one. Anyone with nothing open is skipped by buildDigests.
 *
 * Exported as BOTH GET and POST on purpose: Vercel Cron invokes the path with a
 * GET, while a manual trigger is naturally a POST. Both run the identical
 * guarded handler, so the scheduled and manual paths can never diverge.
 */
async function runDigest(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET not set — refusing to run the jobs digest");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const [{ data: staff }, { data: jobs }, { data: clients }, { data: tasks }] = await Promise.all([
    service.from("profiles").select("id, email").eq("role", "rocking_staff").eq("status", "active"),
    service.from("jobs").select("id, client_id, title, owner_profile_id, status, due_date").not("status", "in", "(done,cancelled)"),
    service.from("clients").select("id, name"),
    service.from("job_tasks").select("id, job_id, label, assignee_profile_id").eq("done", false),
  ]);

  const cn = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const openJobs = jobs ?? [];
  const jobById = new Map(openJobs.map((j) => [j.id, j]));

  const people: DigestPerson[] = (staff ?? []).map((s) => ({
    email: s.email,
    // Reuse the existing staff greeting rule rather than re-deriving it here.
    name: assigneeGreetingName({ kind: "staff", email: s.email, person: null }),
    ownedJobs: openJobs
      .filter((j) => j.owner_profile_id === s.id)
      .map((j) => ({ title: j.title, clientName: cn.get(j.client_id) ?? "—", dueDate: j.due_date })),
    assignedTasks: (tasks ?? [])
      .filter((t) => t.assignee_profile_id === s.id && jobById.has(t.job_id))
      .map((t) => {
        const j = jobById.get(t.job_id)!;
        return { label: t.label, jobTitle: j.title, clientName: cn.get(j.client_id) ?? "—", dueDate: j.due_date };
      }),
  }));

  const digests = buildDigests(people, toDateString(new Date()));

  let sent = 0;
  for (const d of digests) {
    try {
      await sendJobDigest(d.email, d.subject, d.body);
      sent++;
    } catch (e) {
      console.error("jobs digest failed for", d.email, e);
    }
  }
  if (sent < digests.length) {
    console.error(`jobs digest: only ${sent} of ${digests.length} sends succeeded`);
  }
  return NextResponse.json({ recipients: digests.length, sent });
}

export const GET = runDigest;
export const POST = runDigest;
