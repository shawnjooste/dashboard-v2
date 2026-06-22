# Jobs — Admin Work Tracker

**Date:** 2026-06-22
**Status:** Draft design, pending user review
**Project:** Rocking One Client Portal (dashboard-v2)

## Scope

A standalone **admin-only** module to manage small client jobs (micro-projects) —
**"Jobs"** — from open to done, with a checklist per job and deliberate client
notifications. Quotes are one optional on-ramp, not the only source.

**In scope**
- A Jobs **Kanban board**: `To do → In progress → Waiting → Done` (+ a `Cancelled`
  state, hidden off-board). Stage is changed via a **status control** on the card/detail
  (drag-and-drop deferred).
- A **Job** = title, client, owner (Rocking staff), status, internal notes, optional
  linked quote — plus a **checklist** of tasks (label, done, optional staff assignee, order).
- Create a job **ad-hoc**, or **from an accepted quote** (one click, pre-filled).
- **Client comms:** auto-email the client's active managers when a job is **opened** and
  when it's **completed**; a manual **"Post update"** emails a note + logs it. No client
  portal page.
- `rocking_staff`-only throughout (RLS).

**Out of scope (later slices)**
- Drag-and-drop board; a client-facing Jobs page; per-task due dates; custom/editable
  columns; auto-create-on-acceptance.

## Placement
New **"Jobs"** item in the admin sidebar **Business** group, next to Quotes → `/admin/jobs`.

## Data model

- **`jobs`** — `id, client_id → clients, title, owner_profile_id → profiles (nullable),
  status text check in (todo|in_progress|waiting|done|cancelled) default 'todo',
  notes text, waiting_note text (the card tag when status='waiting'),
  quote_id → quotes (nullable), created_at, completed_at (nullable)`.
- **`job_tasks`** — `id, job_id → jobs (on delete cascade), label, done bool default false,
  assignee_profile_id → profiles (nullable), position int, created_at`.
- **`job_updates`** — the activity/client-update log: `id, job_id → jobs (on delete cascade),
  kind text (opened|update|completed), body text, posted_by_profile_id → profiles (nullable),
  emailed_count int, created_at`.

**RLS:** all three tables — `for all using (public.is_rocking_staff()) with check (public.is_rocking_staff())`. Staff write through their authenticated session (server actions); no service-role needed for core writes. Email sending is server-side.

## Board (`/admin/jobs`)

Four columns (`todo`, `in_progress`, `waiting`, `done`); `cancelled` hidden behind a
toggle/filter. Cards show title, client name, owner initials, checklist progress
(`done/total`), a stage dot, and a tag (`from quote`, or the `waiting_note`). A
**"+ New job"** button opens the create form. Within a column, newest-updated first.

**Moving a stage:** open the card → a status control (segmented/dropdown). Moving to
`done` stamps `completed_at` and fires the completed email; moving back out clears
`completed_at` and does **not** re-email.

## Job detail (`/admin/jobs/[id]`)

- Header: title, client, status control, owner.
- **Checklist:** tasks with a checkbox + label + optional assignee; add / tick / delete
  (reorder via position — up/down, optional in v1).
- Internal **notes**.
- **Linked quote** (if `quote_id`) → links to `/admin/quotes/[id]`.
- **Activity log:** `job_updates` entries (opened / update / completed) with time + author,
  and a **"Post update"** composer (textarea + send) that emails the client's active
  managers and logs an `update` entry.

## Creating a job

- **"+ New job":** client (select), title, owner (staff select), optional starter checklist
  (one task per line). On create: insert the job (`todo`), its tasks, an `opened`
  `job_update`, and email the client's active managers ("We've opened a job for you — *title*").
- **"Create job from quote":** a button on **accepted** quotes (admin quote detail). Creates
  a job linked to the quote — `client_id` = quote's client, `title` = quote title, plus a
  generic starter checklist (e.g. "Place supplier order", "Confirm delivery / lead time",
  "Schedule / dispatch", "Confirm completion with client") — then redirects to the job detail
  and emails the managers (opened). *Not* automatic on acceptance — one deliberate click.

## Notifications (Resend, best-effort)

`lib/job-emails.ts` (mirrors `quote-emails.ts`). Recipients = active `client_manager`s of the
job's client. Triggers: **opened**, **completed**, and **post-update**. Email failure is
logged and **never blocks** the state change.

## Error handling
- Email failures are best-effort (logged, non-blocking).
- Deleting a job cascades its tasks + updates.
- `client_id` is required; `owner` optional.
- Re-completing / un-completing a job doesn't duplicate the completed email.

## Testing
- **RLS:** only `rocking_staff` can read/write `jobs`/`job_tasks`/`job_updates`; a client
  manager/member sees none.
- **Notifications:** opened + completed emails reach the right managers; post-update emails.
- **Logic:** checklist progress count; status transitions stamp/clear `completed_at`;
  quote→job link round-trips.
- Build compiles; board + detail render with seeded data.

## Build order
1. Migration: `jobs`, `job_tasks`, `job_updates` + RLS + status check.
2. Data layer `lib/views/jobs.ts` (board list, detail, create, set-status, task add/toggle/delete, post-update) + `lib/job-emails.ts`.
3. Server actions.
4. Board page `/admin/jobs` (Kanban + status control + new-job form).
5. Detail page `/admin/jobs/[id]` (checklist, notes, activity, post-update).
6. "Create job from quote" button on the accepted-quote admin detail.
7. Sidebar nav entry.
8. Verify end-to-end (seed one job, move stages, post an update, create from a quote).
