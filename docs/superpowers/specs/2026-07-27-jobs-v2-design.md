# Jobs v2 — design

**Date:** 2026-07-27
**Surface:** Admin-only Jobs feature (`app/(admin)/admin/jobs/*`).
**Status:** Approved — not yet implemented.

## Why

The Jobs board works but feels unfinished next to a polished tracker (37signals'
[Fizzy](https://github.com/basecamp/fizzy)). This spec closes the gaps that are
actually felt day to day, without replacing what makes Jobs valuable.

**Decision: extend Jobs, do not replace it with Fizzy.** Fizzy is Ruby on Rails +
Hotwire; the portal is Next.js 16 + Supabase. There is no code-reuse path, so
"adopting Fizzy" would mean either running a second disconnected system or a
ground-up port. Either way you lose what Jobs uniquely does: a job belongs to a
`client`, spins off an accepted `quote`, draws owners/assignees from staff *and*
that client's managers, and emails those managers on updates — all under
`rocking_staff` RLS in the same session as Devices, M365 and Quotes. The Kanban is
the least differentiated part of the feature.

Fizzy's licence (O'Saasy) permits self-hosting freely and only forbids reselling
it as a competing hosted service. That is not what this is: this spec copies UX
*ideas*, writing original code, which is not a derivative work of Fizzy's source.

**Design principle:** Fizzy reads as complete because it is tightly edited, not
feature-packed. Copy the polish and the specific missing capabilities; do not copy
its feature count.

## Decisions taken

| Question | Decision |
| --- | --- |
| Client visibility | **Staff-only, unchanged.** RLS stays `is_rocking_staff()` on all job tables. Clients learn about jobs only via the emails staff send. |
| Board columns | **Keep four** (`todo`, `in_progress`, `waiting`, `done`); `cancelled` stays off-board. `waiting` earns its place for an MSP. |
| Due dates | **Job-level only** (`jobs.due_date`). No per-task dates. |
| Drag-and-drop | **Yes — add `@dnd-kit/core` + `@dnd-kit/sortable`.** First runtime UI dependency beyond Supabase. |
| Staff comments | **Yes — new `job_comments` table.** The internal-notes textarea stays for standing context. |
| Notifications | **Email only** (existing Resend paths). No Teams webhook, no in-app inbox. |
| "My work" | **In-app view + weekly digest email.** |
| Auto-archiving done cards | **Cut (YAGNI).** Revisit if the board outgrows one screen. |

## Phasing

Three self-contained phases, each with its own migration and each shippable to
`main` independently. This matches the repo's existing convention of small,
focused, numbered migrations.

---

## Phase 1 — Board feel

**Migration `0057_jobs_board`**

> Numbering note: `0053`–`0056` were taken by the inbound-email/supplier work that
> landed after this spec was first written. Phase 1 is `0057`, Phase 3 is `0058`.
> Re-check the highest existing migration before creating either.

```sql
alter table public.jobs add column due_date date;
alter table public.jobs add column board_position int not null default 0;
create index jobs_status_position_idx on public.jobs (status, board_position);
```

Regenerate types after applying (`supabase gen types typescript --linked > lib/types/database.ts`).

### Components

- **`app/(admin)/admin/jobs/page.tsx`** stays a server component: it fetches and
  passes cards down. All board interactivity moves into a new client component.
- **`app/(admin)/admin/jobs/JobBoard.tsx`** (new, client) — wraps dnd-kit
  `DndContext` + `SortableContext` (one per column). Receives `cards` as props and
  imports types from `lib/views/jobs` with `import type` only.
- **`lib/job-board-helpers.ts`** (new, pure) — `dueState(dueDate, today)` returning
  `"overdue" | "due_soon" | "none"`, and the position maths for a card dropped at
  index *i* of a column. Unit-tested.

### Server actions (`app/(admin)/admin/jobs/actions.ts`)

- `moveJob(jobId, toStatus, toIndex)` — staff guard; computes the new
  `board_position`; **delegates status changes into the same internal path as
  `setJobStatus`** so a drag to Done fires the completion email and writes the
  `completed` row exactly as the button does. This shared path is the whole point:
  duplicating the logic would let dragging silently skip the client email.
- `setJobDueDate(jobId, dueDate | null)` — staff guard, no email.

### Behaviour

- Drag between columns → status change (with all existing side effects).
- Drag within a column → manual ordering via `board_position`.
- Board sort: `board_position` ascending, then `updated_at` descending.
- **Drag to Waiting** leaves `waiting_note` null; the card renders an inline
  "what's it waiting on?" prompt afterwards. The drag is never blocked by a modal.
- Due date is edited on the detail page; the card shows a red badge when overdue
  and an amber one when due within 2 days.

---

## Phase 2 — Finding work

**No migration.**

### Board filters

A filter bar on the board using the **existing `searchParams` + `qs()` pill
pattern** from `app/(admin)/admin/activity/page.tsx` — server-rendered links, no
client state. Filters: `client`, `owner`, `assignee`, and a "just mine" toggle.
Filtering happens after the existing `getJobBoard()` fetch, consistent with how
the activity page filters in memory.

### My work

**`app/(admin)/admin/jobs/mine/page.tsx`** — for the signed-in staffer: jobs they
own and tasks assigned to them across all jobs, overdue first. Backed by a new
`getMyWork(profileId)` in `lib/views/jobs.ts`.

### Weekly digest

- **`lib/job-digest.ts`** (new, pure) — builds the per-person digest content
  (owned jobs, tasks assigned elsewhere, overdue flagged first) from plain data.
  Unit-tested. Shared by both the scheduled send and any on-demand send, so the
  two can never drift.
- **`app/api/jobs/digest/route.ts`** (new) — POST handler guarded by a
  `CRON_SECRET` env var; loads open jobs via the service client, builds content
  with `lib/job-digest.ts`, sends via Resend. Follow the existing route-handler
  precedent at `app/api/paystack/webhook/route.ts` (currently the only one).
- **Schedule:** Vercel cron, Monday morning, since the app already deploys to
  Vercel. **`vercel.json` does not exist yet** — it must be created with the
  `crons` entry.
- Recipients: active `rocking_staff` who own an open job or are assigned an open
  task. Staff with nothing open get no email.

---

## Phase 3 — Card depth

**Migration `0059_job_comments_pin`**

> Numbering note: `0058` was taken by `0058_drop_redundant_supplier_contact_email`
> while Phase 1 was in flight. Re-check the highest existing migration before
> creating this one — the number drifts as other work lands.

```sql
create table public.job_comments (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs(id) on delete cascade,
  body              text not null,
  author_profile_id uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index job_comments_job_idx on public.job_comments (job_id, created_at);

alter table public.job_comments enable row level security;
create policy job_comments_staff on public.job_comments
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

alter table public.jobs add column pinned boolean not null default false;

alter table public.job_updates drop constraint job_updates_kind_check;
alter table public.job_updates add constraint job_updates_kind_check
  check (kind in ('opened','update','completed','status','assigned'));
```

### Staff comments

A comment thread on the detail page, below the checklist — separate from the
internal-notes textarea (standing context) and from the client-updates panel
(outbound). Staff-only, never emailed to clients. Actions: `addJobComment`,
`deleteJobComment`, both staff-guarded.

### Golden ticket

`jobs.pinned` — a pinned card sorts to the top of its column ahead of
`board_position` and renders with a highlight. Action: `toggleJobPinned`.

### Activity trail

**Reuse `job_updates` rather than add a third log table.** System events (status
changes, assignment changes) are written with the new `'status'` and `'assigned'`
kinds. Two consumers, clearly separated:

- The existing **"Client updates"** card filters to `opened | update | completed`
  only — so its meaning is unchanged and no internal noise leaks into the panel
  that describes what the client was told.
- A new **"Activity"** list shows every kind.

Assignment emails, which today are best-effort and unrecorded, are logged here as
`'assigned'` once the constraint allows it.

---

## Testing

Pure helpers get vitest tests, colocated, relative imports — matching the existing
`greetingName` / `assignmentEmailContent` / `reorderSwap` pattern:

- `dueState` — overdue, due-soon boundary, no date, today.
- Board position maths — drop at top, middle, end of a column.
- `lib/job-digest.ts` — a person owning jobs, a person only assigned tasks, a
  person with nothing open, overdue ordering.
- Activity formatting for the new kinds.

`npx vitest run` and `npm run build` before every push. Regenerate database types
after each migration or `.from("...")` types as `never`.

## Risks and callouts

1. **Shared status path.** Drag-to-Done and the status button must run one code
   path. Any divergence silently skips the client completion email.
2. **Board becomes a client component.** Per CLAUDE.md, client components import
   types from `lib/views/*` with `import type` only; importing a runtime value from
   a server-coupled module breaks the build. Label maps must be redefined locally.
3. **New runtime dependency.** dnd-kit is the first UI package beyond Supabase.
4. **Digest needs secrets.** `CRON_SECRET` in Vercel env; the route must reject
   unauthenticated calls.
5. **Type regen per migration**, three times across the phases.
6. `job_updates.kind` is referenced by existing display code (`KIND_LABEL` in the
   detail page); extending the constraint requires updating that map or unknown
   kinds render raw.
