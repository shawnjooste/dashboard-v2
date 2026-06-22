"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { notifyJobOpened, notifyJobCompleted, notifyJobUpdate } from "@/lib/job-emails";
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

  let emailed = 0;
  try {
    emailed = await notifyJobOpened({ clientId: args.clientId, title: args.title });
  } catch (e) {
    console.error("job opened email failed:", e);
  }
  await supabase.from("job_updates").insert({ job_id: job.id, kind: "opened", posted_by_profile_id: actorId, emailed_count: emailed });
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

export async function setJobStatus(jobId: string, status: JobStatus, waitingNote: string | null) {
  const me = await staff();
  if (!STATUSES.includes(status)) throw new Error("invalid status");
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("client_id, title, status").eq("id", jobId).maybeSingle();
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
    let emailed = 0;
    try {
      emailed = await notifyJobCompleted({ clientId: job.client_id, title: job.title });
    } catch (e) {
      console.error("job completed email failed:", e);
    }
    await supabase.from("job_updates").insert({ job_id: jobId, kind: "completed", posted_by_profile_id: me.id, emailed_count: emailed });
  }
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

export async function postJobUpdate(jobId: string, body: string) {
  const me = await staff();
  const clean = body.trim();
  if (!clean) return;
  const supabase = await createClient();
  const { data: job } = await supabase.from("jobs").select("client_id, title").eq("id", jobId).maybeSingle();
  if (!job) throw new Error("job not found");
  let emailed = 0;
  try {
    emailed = await notifyJobUpdate({ clientId: job.client_id, title: job.title, body: clean });
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
