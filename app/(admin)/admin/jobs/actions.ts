"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { notifyJobUpdate, notifyTaskAssigned } from "@/lib/job-emails";
import type { PersonName, AssigneeKind } from "@/lib/job-email-helpers";
import { reorderSwap } from "@/lib/job-task-helpers";
import { placeCard } from "@/lib/job-board-helpers";
import type { JobStatus } from "@/lib/views/jobs";

const STATUSES: JobStatus[] = ["todo", "in_progress", "waiting", "done", "cancelled"];

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

const FROM_QUOTE_TASKS = [
  "Place supplier order",
  "Confirm delivery / lead time",
  "Schedule / dispatch",
  "Confirm completion with client",
];

/** Insert a job + its tasks + an 'opened' update, and email the managers. */
async function openJob(
  args: { clientId: string; title: string; ownerProfileId: string | null; notes: string | null; quoteId: string | null; tasks: string[] },
  actorId: string,
): Promise<string> {
  const supabase = await createClient();
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({ client_id: args.clientId, title: args.title, owner_profile_id: args.ownerProfileId, notes: args.notes, quote_id: args.quoteId })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (args.tasks.length) {
    await supabase.from("job_tasks").insert(args.tasks.map((label, i) => ({ job_id: job.id, label, position: i })));
  }

  // Opening a job deliberately does NOT email the client. The only client-facing
  // job mail is the explicit "Post update" form — see postJobUpdate.
  await supabase.from("job_updates").insert({ job_id: job.id, kind: "opened", posted_by_profile_id: actorId, emailed_count: 0 });
  return job.id;
}

export async function createJob(formData: FormData) {
  const me = await staff();
  const clientId = String(formData.get("client_id") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const ownerProfileId = String(formData.get("owner_profile_id") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const tasks = String(formData.get("tasks") ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  if (!clientId || !title) throw new Error("client and title are required");

  const id = await openJob({ clientId, title, ownerProfileId, notes, quoteId: null, tasks }, me.id);
  revalidatePath("/admin/jobs");
  redirect(`/admin/jobs/${id}`);
}

export async function createJobFromQuote(quoteId: string) {
  const me = await staff();
  const supabase = await createClient();
  const { data: quote } = await supabase.from("quotes").select("client_id, title").eq("id", quoteId).maybeSingle();
  if (!quote) throw new Error("quote not found");
  const id = await openJob({ clientId: quote.client_id, title: quote.title, ownerProfileId: me.id, notes: null, quoteId, tasks: FROM_QUOTE_TASKS }, me.id);
  revalidatePath("/admin/jobs");
  redirect(`/admin/jobs/${id}`);
}

/**
 * The one status transition path — used by the status buttons and by a board
 * drag. Handles the completed_at stamp, the client completion email, and the
 * 'completed' activity row. Callers do the staff() guard and revalidation.
 */
async function applyStatusChange(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  status: JobStatus,
  waitingNote: string | null,
  actorId: string,
) {
  const { data: job } = await supabase
    .from("jobs")
    .select("client_id, title, status, owner_profile_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) throw new Error("job not found");

  const justCompleted = status === "done" && job.status !== "done";
  const patch: { status: JobStatus; waiting_note: string | null; updated_at: string; completed_at?: string | null } = {
    status,
    waiting_note: status === "waiting" ? (waitingNote?.trim() || null) : null,
    updated_at: new Date().toISOString(),
  };
  if (justCompleted) patch.completed_at = new Date().toISOString();
  if (status !== "done" && job.status === "done") patch.completed_at = null;
  await supabase.from("jobs").update(patch).eq("id", jobId);

  if (justCompleted) {
    // Completing a job deliberately does NOT email the client — tell them via the
    // "Post update" form if they should know. The row is still logged as activity.
    await supabase.from("job_updates").insert({ job_id: jobId, kind: "completed", posted_by_profile_id: actorId, emailed_count: 0 });
  } else if (job.status !== status) {
    // Internal trail only — no email, and never shown in the client panel.
    await supabase.from("job_updates").insert({
      job_id: jobId,
      kind: "status",
      body: `${job.status} → ${status}`,
      posted_by_profile_id: actorId,
      emailed_count: 0,
    });
  }
}

export async function setJobStatus(jobId: string, status: JobStatus, waitingNote: string | null) {
  const me = await staff();
  if (!STATUSES.includes(status)) throw new Error("invalid status");
  const supabase = await createClient();
  await applyStatusChange(supabase, jobId, status, waitingNote, me.id);
  revalidatePath("/admin/jobs");
  revalidatePath(`/admin/jobs/${jobId}`);
}

export async function addTask(jobId: string, label: string) {
  await staff();
  const clean = label.trim();
  if (!clean) return;
  const supabase = await createClient();
  const { data: max } = await supabase.from("job_tasks").select("position").eq("job_id", jobId).order("position", { ascending: false }).limit(1).maybeSingle();
  await supabase.from("job_tasks").insert({ job_id: jobId, label: clean, position: (max?.position ?? -1) + 1 });
  await supabase.from("jobs").update({ updated_at: new Date().toISOString() }).eq("id", jobId);
  revalidatePath(`/admin/jobs/${jobId}`);
}

export async function toggleTask(taskId: string, jobId: string, done: boolean) {
  await staff();
  const supabase = await createClient();
  await supabase.from("job_tasks").update({ done }).eq("id", taskId);
  await supabase.from("jobs").update({ updated_at: new Date().toISOString() }).eq("id", jobId);
  revalidatePath(`/admin/jobs/${jobId}`);
}

export async function deleteTask(taskId: string, jobId: string) {
  await staff();
  const supabase = await createClient();
  await supabase.from("job_tasks").delete().eq("id", taskId);
  revalidatePath(`/admin/jobs/${jobId}`);
}

/** Move a task one step up or down its checklist (swaps positions with its neighbour). */
export async function moveTask(taskId: string, jobId: string, direction: "up" | "down") {
  await staff();
  const supabase = await createClient();
  const { data: tasks } = await supabase
    .from("job_tasks")
    .select("id, position")
    .eq("job_id", jobId)
    .order("position")
    .order("created_at");
  const swap = reorderSwap(tasks ?? [], taskId, direction);
  if (!swap) return; // at an end / unknown task — nothing to do
  await Promise.all(swap.map((s) => supabase.from("job_tasks").update({ position: s.position }).eq("id", s.id)));
  await supabase.from("jobs").update({ updated_at: new Date().toISOString() }).eq("id", jobId);
  revalidatePath(`/admin/jobs/${jobId}`);
}

export async function postJobUpdate(jobId: string, body: string) {
  const me = await staff();
  const clean = body.trim();
  if (!clean) return;
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("client_id, title, owner_profile_id").eq("id", jobId).maybeSingle();
  if (!job) throw new Error("job not found");
  let emailed = 0;
  try {
    emailed = await notifyJobUpdate({ clientId: job.client_id, title: job.title, body: clean, ownerProfileId: job.owner_profile_id });
  } catch (e) {
    console.error("job update email failed:", e);
  }
  await supabase.from("job_updates").insert({ job_id: jobId, kind: "update", body: clean, posted_by_profile_id: me.id, emailed_count: emailed });
  await supabase.from("jobs").update({ updated_at: new Date().toISOString() }).eq("id", jobId);
  revalidatePath(`/admin/jobs/${jobId}`);
}

export async function saveJobNotes(formData: FormData) {
  await staff();
  const jobId = String(formData.get("job_id") ?? "");
  const notes = String(formData.get("notes") ?? "").trim() || null;
  if (!jobId) return;
  const supabase = await createClient();
  await supabase.from("jobs").update({ notes, updated_at: new Date().toISOString() }).eq("id", jobId);
  revalidatePath(`/admin/jobs/${jobId}`);
}

/** Assign (or clear) a task's assignee. Emails a newly-assigned person; owner BCC'd. */
export async function setTaskAssignee(taskId: string, jobId: string, assigneeProfileId: string | null) {
  const me = await staff();
  const supabase = await createClient();
  const { data: task } = await supabase.from("job_tasks").select("assignee_profile_id, label").eq("id", taskId).maybeSingle();
  if (!task) throw new Error("task not found");
  const { data: job } = await supabase.from("jobs").select("client_id, title, owner_profile_id").eq("id", jobId).maybeSingle();
  if (!job) throw new Error("job not found");

  // Validate the assignee is allowed for this job: active staff, or an active
  // manager of *this* client. Reject anything else.
  let assignee: { email: string; kind: AssigneeKind; person: PersonName } | null = null;
  if (assigneeProfileId) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("email, role, status, client_id, people:person_id(first_name, display_name)")
      .eq("id", assigneeProfileId)
      .maybeSingle();
    if (!prof || prof.status !== "active") throw new Error("invalid assignee");
    const person = (Array.isArray(prof.people) ? prof.people[0] : prof.people) as PersonName;
    if (prof.role === "rocking_staff") assignee = { email: prof.email, kind: "staff", person };
    else if (prof.role === "client_manager" && prof.client_id === job.client_id) assignee = { email: prof.email, kind: "client", person };
    else throw new Error("assignee not allowed for this job");
  }

  await supabase.from("job_tasks").update({ assignee_profile_id: assigneeProfileId }).eq("id", taskId);
  await supabase.from("jobs").update({ updated_at: new Date().toISOString() }).eq("id", jobId);

  // Email only on a *new* assignment (not unassign, not re-selecting the same person),
  // and only when the assignee is Rocking staff. A client manager can still be
  // assigned a task — it shows on the job and in the activity trail — but clients
  // are never mailed automatically; the "Post update" form is the only client-facing
  // job mail.
  if (assignee && assignee.kind === "staff" && assigneeProfileId !== task.assignee_profile_id) {
    try {
      let ownerEmailAddr: string | null = null;
      if (job.owner_profile_id) {
        const { data: o } = await supabase.from("profiles").select("email").eq("id", job.owner_profile_id).maybeSingle();
        ownerEmailAddr = o?.email ?? null;
      }
      await notifyTaskAssigned({ assignee, jobTitle: job.title, taskLabel: task.label, ownerEmail: ownerEmailAddr, clientId: job.client_id });
    } catch (e) {
      console.error("task assigned email failed:", e);
    }
  }

  // Record every new assignment, staff or client, emailed or not.
  if (assignee && assigneeProfileId !== task.assignee_profile_id) {
    await supabase.from("job_updates").insert({
      job_id: jobId,
      kind: "assigned",
      body: `${task.label} → ${assignee.email}`,
      posted_by_profile_id: me.id,
      emailed_count: 0,
    });
  }
  revalidatePath(`/admin/jobs/${jobId}`);
}

/** Set (or clear) the job owner. Owner must be active rocking_staff. No email. */
export async function setJobOwner(jobId: string, ownerProfileId: string | null) {
  await staff();
  const supabase = await createClient();
  if (ownerProfileId) {
    const { data: prof } = await supabase.from("profiles").select("role, status").eq("id", ownerProfileId).maybeSingle();
    if (!prof || prof.role !== "rocking_staff" || prof.status !== "active") throw new Error("owner must be active staff");
  }
  await supabase.from("jobs").update({ owner_profile_id: ownerProfileId, updated_at: new Date().toISOString() }).eq("id", jobId);
  revalidatePath(`/admin/jobs/${jobId}`);
}

/**
 * Board drag: move a job to `toStatus` at `toIndex` within that column.
 * A column change runs the same transition as the status buttons (including the
 * completion email). Dropping into 'waiting' leaves waiting_note null — the card
 * prompts for it afterwards rather than blocking the drag.
 */
export async function moveJob(jobId: string, toStatus: JobStatus, toIndex: number) {
  const me = await staff();
  if (!STATUSES.includes(toStatus)) throw new Error("invalid status");
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("status").eq("id", jobId).maybeSingle();
  if (!job) throw new Error("job not found");

  if (job.status !== toStatus) {
    await applyStatusChange(supabase, jobId, toStatus, null, me.id);
  }

  const { data: column } = await supabase
    .from("jobs")
    .select("id")
    .eq("status", toStatus)
    // Must match getJobBoard's ordering (pinned, then position, then recency) —
    // the drop index is computed against what the user sees.
    .order("pinned", { ascending: false })
    .order("board_position", { ascending: true })
    .order("updated_at", { ascending: false });

  const placed = placeCard((column ?? []).map((c) => c.id), jobId, toIndex);
  // These writes are non-transactional by design (see the Jobs v2 spec). Discarding
  // their errors, though, made a failed reorder indistinguishable from a drag that
  // never reached the server — so surface both the attempt and any failure.
  const results = await Promise.all(
    placed.map((p) => supabase.from("jobs").update({ board_position: p.position }).eq("id", p.id)),
  );
  const failed = results.filter((r) => r.error);
  if (failed.length) {
    console.error("moveJob: board_position write failed", failed.map((f) => f.error?.message));
  } else {
    console.log(`moveJob: ${jobId} -> ${toStatus}@${toIndex}, renumbered ${placed.length} card(s)`);
  }

  revalidatePath("/admin/jobs");
  revalidatePath(`/admin/jobs/${jobId}`);
}

/** Set or clear a job's target date. No email. */
export async function setJobDueDate(jobId: string, dueDate: string | null) {
  await staff();
  const supabase = await createClient();
  const { error } = await supabase
    .from("jobs")
    .update({ due_date: dueDate || null, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/jobs");
  revalidatePath(`/admin/jobs/${jobId}`);
}

/** Add a staff comment. Internal only — never emailed, never shown to clients. */
export async function addJobComment(jobId: string, body: string) {
  const me = await staff();
  const clean = body.trim();
  if (!clean) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("job_comments")
    .insert({ job_id: jobId, body: clean, author_profile_id: me.id });
  if (error) throw new Error(error.message);
  await supabase.from("jobs").update({ updated_at: new Date().toISOString() }).eq("id", jobId);
  revalidatePath(`/admin/jobs/${jobId}`);
}

/** Remove a staff comment. */
export async function deleteJobComment(commentId: string, jobId: string) {
  await staff();
  const supabase = await createClient();
  const { error } = await supabase.from("job_comments").delete().eq("id", commentId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/jobs/${jobId}`);
}

/** Golden ticket: pin a job to the top of its board column. No email. */
export async function toggleJobPinned(jobId: string, pinned: boolean) {
  await staff();
  const supabase = await createClient();
  const { error } = await supabase.from("jobs").update({ pinned }).eq("id", jobId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/jobs");
  revalidatePath(`/admin/jobs/${jobId}`);
}
