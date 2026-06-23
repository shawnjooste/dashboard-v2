# Job task assignees + job owner — design

**Date:** 2026-06-23
**Surface:** Admin-only Jobs feature (`app/(admin)/admin/jobs/*`).
**Status:** Approved — building.

## Goal

Two related additions to the Jobs work tracker:

1. **Per-task assignees.** Assign each checklist task to a person. The pool is all
   active Rocking staff **plus** the job's client's active managers. Assigning a
   task (to a new person) emails that person about the task.
2. **Job owner.** A job has one owner — the admin responsible for the whole job.
   The owner receives a copy (BCC) of **any** email sent for the job. The owner can
   only be an admin (`rocking_staff`).

## Non-goals / trade-offs (deliberate)

- **No migration.** `job_tasks.assignee_profile_id` and `jobs.owner_profile_id`
  already exist (0034_jobs.sql). Nothing schema-side changes.
- **Assignment emails are best-effort and NOT recorded** in `job_updates`. The
  `job_updates.kind` check is `('opened','update','completed')`; logging an
  `assigned` kind would need a migration — out of scope.
- BCC means the owner literally receives the client's copy of opened/completed/
  update emails, greeting and all ("literally the same message").

## Data model

Unchanged. Relevant existing columns:

- `jobs.owner_profile_id → profiles(id)` (nullable, `on delete set null`).
- `job_tasks.assignee_profile_id → profiles(id)` (nullable, `on delete set null`).
- Names live on `people` (`first_name`, `display_name`), linked via
  `profiles.person_id`.

## Components

### Data layer — `lib/views/jobs.ts`

- `JobTask` gains `assigneeProfileId: string | null` (so the picker shows the
  current selection; `assigneeLabel` stays for display).
- `JobDetail` gains `ownerLabel: string | null` (keeps `ownerProfileId`).
- New `getJobAssignees(clientId)`:
  `Promise<{ id: string; label: string; kind: "staff" | "client" }[]>`
  = active `rocking_staff` ∪ active `client_manager` of `clientId`. Staff labelled
  via `emailLabel(email)`; clients via `people.display_name` (fallback email).
  Sorted staff-first, then by label.

### Server actions — `app/(admin)/admin/jobs/actions.ts`

- `setTaskAssignee(taskId, jobId, assigneeProfileId | null)`
  - `staff()` guard.
  - Load the task's current `assignee_profile_id`, and the job's `client_id`,
    `title`, `owner_profile_id`.
  - **Validate** the new assignee is in the pool: an active `rocking_staff`, OR an
    active `client_manager` whose `client_id` = the job's `client_id`. Reject
    otherwise (`throw`).
  - Update `assignee_profile_id`; bump `jobs.updated_at`.
  - **Email only when the assignee changed to a new non-null person** (not on
    unassign, not when re-selecting the same person). Best-effort via
    `notifyTaskAssigned`; BCC the owner (skipped when owner is null/has no email or
    owner === assignee).
  - `revalidatePath(/admin/jobs/<id>)`.
- `setJobOwner(jobId, ownerProfileId | null)`
  - `staff()` guard; validate target is active `rocking_staff` (or null).
  - Update `owner_profile_id`; `revalidatePath`. No email.

### Emails — `lib/job-emails.ts` + `lib/job-email-helpers.ts`

- `sendEmail(to, subject, html, bcc?)` — adds optional `bcc: string[]` (Resend
  `bcc` field).
- Owner BCC on the existing client emails:
  - `notifyJobOpened` (per-manager loop) — owner BCC'd on the **first** send only,
    skipped if owner is one of the recipients.
  - `notifyJobCompleted` / `notifyJobUpdate` (single send) — owner BCC'd on it.
  - These functions gain an `ownerProfileId?: string | null` input; they resolve
    the owner's email server-side and skip cleanly when absent.
- `notifyTaskAssigned({ assignee: { email, name, kind }, jobTitle, taskLabel, ownerEmail? })`
  → sends to the assignee, BCC owner (when present and ≠ assignee). Returns sent
  count (0/1).
- **Pure helper** `assignmentEmailContent({ kind, name, jobTitle, taskLabel })`
  → `{ subject, html }`, two tones:
  - `kind: "staff"` → "You've been assigned a task on `<jobTitle>`: `<taskLabel>`".
  - `kind: "client"` → "Hi `<name>`, there's an action for you on your job with
    Rocking (`<jobTitle>`): `<taskLabel>`".
  Tested both branches.

### UI

- `app/(admin)/admin/jobs/[id]/JobChecklist.tsx` — a compact assignee `<select>`
  per row: `Unassigned` + `<optgroup label="Rocking">` / `<optgroup label="Client">`.
  Uses the existing `useTransition` + `router.refresh()` pattern; calls
  `setTaskAssignee`. Receives `assignees: { id, label, kind }[]`.
- `app/(admin)/admin/jobs/[id]/JobOwnerControl.tsx` (new client component) — owner
  display + `<select>` of active staff; calls `setJobOwner`.
- `app/(admin)/admin/jobs/[id]/page.tsx` — calls `getJobAssignees(job.clientId)`
  and `getJobFormOptions()` (staff list for the owner picker), passes them down.

## Email-flow rules (summary)

| Trigger | To | BCC owner? |
| --- | --- | --- |
| Job opened | client managers (per-manager) | yes, once (first send), skip if owner is a recipient |
| Job completed | client managers | yes |
| Manual update | client managers | yes |
| Task assigned (new assignee) | the assignee (2-tone) | yes, unless owner === assignee |
| Owner changed | — | no email |

In all cases: no managers / no owner ⇒ that leg simply doesn't send. All emails
best-effort (try/catch, never block the action).

## Testing

- `assignmentEmailContent` — staff tone, client tone (vitest, colocated,
  relative import).
- Pool/owner validation helper if extracted as pure logic.
- Existing `greetingName` tests stay green.
- `npm run build` + `vitest run` before pushing.
