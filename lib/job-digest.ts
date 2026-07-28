// Pure content builder for the weekly "your open work" digest. No Supabase and
// no network — the caller loads the data and sends the mail, so the same content
// is produced whether the send is scheduled or manual.
import { compareByDue, dueState } from "./job-board-helpers";

export type DigestJob = { title: string; clientName: string; dueDate: string | null };
export type DigestTask = { label: string; jobTitle: string; clientName: string; dueDate: string | null };
export type DigestPerson = {
  email: string;
  name: string;
  ownedJobs: DigestJob[];
  assignedTasks: DigestTask[];
};
export type Digest = { email: string; subject: string; body: string };

const OVERDUE = `<span style="color:#B91C1C; font-weight:600;">Overdue</span>`;
const DUE_SOON = `<span style="color:#B45309;">Due soon</span>`;

/** " — Overdue" / " — Due soon" / "" for a due date, relative to `today`. */
function dueSuffix(dueDate: string | null, today: string): string {
  const state = dueState(dueDate, today);
  if (state === "overdue") return ` — ${OVERDUE}`;
  if (state === "due_soon") return ` — ${DUE_SOON}`;
  return "";
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One person's digest, or null when they have nothing open (send them nothing). */
export function buildDigest(person: DigestPerson, today: string): Digest | null {
  const jobs = [...person.ownedJobs].sort(compareByDue);
  const tasks = [...person.assignedTasks].sort(compareByDue);
  if (jobs.length === 0 && tasks.length === 0) return null;

  const parts: string[] = [];
  if (jobs.length) parts.push(plural(jobs.length, "job"));
  if (tasks.length) parts.push(plural(tasks.length, "task"));
  const subject = `Your open work — ${parts.join(", ")}`;

  let body = `<p style="color:#444; margin:0 0 14px;">Hi ${person.name},</p>`;
  body += `<p style="color:#444; margin:0 0 16px;">Here's what's still open on your plate.</p>`;

  if (jobs.length) {
    body += `<h3 style="margin:0 0 6px; font-size:15px;">Jobs you own</h3>`;
    for (const j of jobs) {
      body += `<p style="color:#444; margin:0 0 6px;"><strong>${j.title}</strong>${dueSuffix(j.dueDate, today)}<br>`;
      body += `<span style="color:#888; font-size:13px;">${j.clientName}</span></p>`;
    }
  }

  if (tasks.length) {
    body += `<h3 style="margin:16px 0 6px; font-size:15px;">Tasks assigned to you</h3>`;
    for (const t of tasks) {
      body += `<p style="color:#444; margin:0 0 6px;"><strong>${t.label}</strong>${dueSuffix(t.dueDate, today)}<br>`;
      body += `<span style="color:#888; font-size:13px;">${t.jobTitle} · ${t.clientName}</span></p>`;
    }
  }

  return { email: person.email, subject, body };
}

/** Digests for everyone who has something open. People with nothing open are skipped. */
export function buildDigests(people: DigestPerson[], today: string): Digest[] {
  return people.map((p) => buildDigest(p, today)).filter((d): d is Digest => d !== null);
}
