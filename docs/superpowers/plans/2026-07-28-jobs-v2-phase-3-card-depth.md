# Jobs v2 — Phase 3: Card Depth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a job somewhere to hold a conversation, a way to be marked urgent, and a record of what actually happened to it.

**Architecture:** Staff comments get their own table; pinning is one boolean that sorts ahead of `board_position`; the activity trail reuses `job_updates` with two new kinds rather than adding a third log table, with a pure, tested module deciding which kinds are client-facing so the existing "Client updates" panel keeps its exact meaning.

**Tech Stack:** Next.js 16 (App Router), React 19, Supabase (Postgres + RLS), Tailwind v4, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-07-27-jobs-v2-design.md` (Phase 3 section).

## Global Constraints

- Supabase project ref is `eskhokedsximnslgsycs`. Never point at `qomxwxxulxcwnpaqzudl`.
- All work happens on `main`. Do not create a `preview` branch.
- **Do not `git push`.** The branch carries 7 unpushed commits belonging to another
  workstream (the `sent_emails` / communications feature). Pushing would publish
  them. Commit locally only; the controller handles pushing.
- Conventional commit messages. End every commit message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Server reads use `lib/supabase/server` (RLS-scoped). Service-role
  (`lib/supabase/service`) is server-only and must not appear in this phase.
- Server actions start with `"use server"` and guard with the existing `staff()` check.
- **Client components import from `lib/views/*` with `import type` only.** Pure
  modules (`lib/job-board-helpers.ts`, `lib/job-digest.ts`, and the new
  `lib/job-activity.ts`) have no Supabase import and ARE safe as runtime imports.
- Design tokens: `bg-card`, `border-line`, `text-ink/ink-2/ink-3`, `text-muted`,
  `text-faint`, `text-brand` (#D7141C), `text-good`, `bg-warn-tint`/`text-warn-ink`,
  `bg-line-soft`, `bg-canvas`. Reuse `PageHeader`, `Card`, `CardHeader`, `initials`
  from `@/components/ui`.
- Tests are vitest, colocated, RELATIVE imports (`./job-activity`).
- **The migration number is `0063`.** `0057`–`0062` are taken. This number has now
  drifted THREE times because other workstreams land migrations while this plan is
  being executed. **Re-confirm with `ls supabase/migrations | tail -3` immediately
  before creating the file**, and if a higher number exists, use the next free one
  consistently throughout the task.
- After the migration, regenerate types or `.from("...")` is typed `never`:
  `supabase gen types typescript --linked > lib/types/database.ts`
- Verify with `npx vitest run` and `npm run build` before every commit.
- **Comments are staff-only and are never emailed.** No Resend call anywhere in
  this phase.

## Context you need

- `job_updates` currently allows `kind in ('opened','update','completed')`
  (`supabase/migrations/0034_jobs.sql:38`). The detail page renders it through
  `KIND_LABEL` at `app/(admin)/admin/jobs/[id]/page.tsx:12`, which only knows
  those three — extending the constraint without extending that map renders raw
  kind strings.
- A separate `sent_emails` table (migration `0061`) now records every email the
  portal sends, including task-assignment emails. The `'assigned'` activity row
  this phase adds is deliberately **not** redundant with it: it records the
  *event* (who reassigned what), fires even when no email is sent (unassigning),
  and is scoped to the job. Do not try to read `sent_emails` here.

## File structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/0063_job_comments_pin.sql` (create) | comments table, `pinned`, extended kind constraint |
| `lib/job-activity.ts` (create) | pure: which kinds are client-facing, and their labels |
| `lib/job-activity.test.ts` (create) | its tests |
| `lib/views/jobs.ts` (modify) | `pinned` on card + detail, `comments` on detail |
| `app/(admin)/admin/jobs/actions.ts` (modify) | comment actions, pin action, activity logging |
| `app/(admin)/admin/jobs/JobBoard.tsx` (modify) | pinned highlight |
| `app/(admin)/admin/jobs/[id]/JobComments.tsx` (create) | comment thread UI |
| `app/(admin)/admin/jobs/[id]/JobPinControl.tsx` (create) | pin toggle |
| `app/(admin)/admin/jobs/[id]/page.tsx` (modify) | render comments, activity, pin |

---

### Task 1: Migration and types

**Files:**
- Create: `supabase/migrations/0063_job_comments_pin.sql`
- Modify: `lib/types/database.ts` (regenerated, never hand-edited)

**Interfaces:**
- Consumes: nothing.
- Produces: table `job_comments`; column `jobs.pinned` (`boolean not null default false`);
  `job_updates.kind` additionally accepts `'status'` and `'assigned'`.

- [ ] **Step 1: Confirm the migration number is still free**

Run: `ls supabase/migrations | tail -3`

Expected: the highest is `0062_staff_supplier_request.sql`, making `0063` free.
Other workstreams are actively landing migrations in this repo, so if a higher
number now exists, use the next free one and keep it consistent for the rest of
this task — including in the commit message.

- [ ] **Step 2: Create the migration**

Create `supabase/migrations/0063_job_comments_pin.sql`:

```sql
-- Jobs v2 phase 3. Three additions:
--   1. job_comments — staff discussion on a job. Separate from jobs.notes
--      (standing context) and from job_updates (what the client was told).
--      Staff-only, never emailed.
--   2. jobs.pinned — the "golden ticket": sorts a card to the top of its column.
--   3. job_updates gains 'status' and 'assigned' so the same table can carry the
--      internal activity trail. The client-updates panel keeps its meaning by
--      filtering to the original three kinds (see lib/job-activity.ts).
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

- [ ] **Step 3: Apply it**

Run: `supabase db push --linked`
Expected: `0063_job_comments_pin.sql` listed as applied, no errors.

- [ ] **Step 4: Regenerate types**

Run: `supabase gen types typescript --linked > lib/types/database.ts`

- [ ] **Step 5: Verify the new shapes are in the generated types**

Run: `grep -c "job_comments" lib/types/database.ts`
Expected: a number greater than 0.

Run: `grep -c "pinned" lib/types/database.ts`
Expected: a number greater than 0.

- [ ] **Step 6: Verify the build**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0063_job_comments_pin.sql lib/types/database.ts
git commit -m "feat(jobs): job_comments table, pinned flag, activity kinds

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure activity module

The one thing that keeps the client-updates panel honest: a single tested place
that decides which kinds are client-facing.

**Files:**
- Create: `lib/job-activity.ts`
- Test: `lib/job-activity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `CLIENT_UPDATE_KINDS: readonly string[]`
  - `isClientUpdate(kind: string): boolean`
  - `activityLabel(kind: string): string`

- [ ] **Step 1: Write the failing tests**

Create `lib/job-activity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isClientUpdate, activityLabel, CLIENT_UPDATE_KINDS } from "./job-activity";

describe("isClientUpdate", () => {
  it("is true for the kinds the client was actually told about", () => {
    expect(isClientUpdate("opened")).toBe(true);
    expect(isClientUpdate("update")).toBe(true);
    expect(isClientUpdate("completed")).toBe(true);
  });
  it("is false for internal activity kinds", () => {
    expect(isClientUpdate("status")).toBe(false);
    expect(isClientUpdate("assigned")).toBe(false);
  });
  it("is false for an unknown kind, so new internal kinds never leak into the client panel", () => {
    expect(isClientUpdate("something_new")).toBe(false);
  });
  it("exposes exactly the three client kinds", () => {
    expect([...CLIENT_UPDATE_KINDS].sort()).toEqual(["completed", "opened", "update"]);
  });
});

describe("activityLabel", () => {
  it("labels every known kind", () => {
    expect(activityLabel("opened")).toBe("Opened");
    expect(activityLabel("update")).toBe("Update sent");
    expect(activityLabel("completed")).toBe("Completed");
    expect(activityLabel("status")).toBe("Status changed");
    expect(activityLabel("assigned")).toBe("Task assigned");
  });
  it("falls back to the raw kind rather than rendering blank", () => {
    expect(activityLabel("something_new")).toBe("something_new");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/job-activity.test.ts`
Expected: FAIL — cannot resolve `./job-activity`.

- [ ] **Step 3: Implement**

Create `lib/job-activity.ts`:

```ts
// Pure helpers for the job activity trail. No Supabase import — safe from both
// server and client components.
//
// job_updates carries two audiences in one table. These helpers are the single
// place that decides which is which, so the "Client updates" panel can never
// silently start showing internal events.

/** Kinds that represent something the CLIENT was actually told. */
export const CLIENT_UPDATE_KINDS = ["opened", "update", "completed"] as const;

/**
 * Whether a job_updates row belongs in the client-facing panel. Unknown kinds
 * are treated as internal on purpose: a future kind added to the constraint
 * should never leak into the client panel just because nobody updated this list.
 */
export function isClientUpdate(kind: string): boolean {
  return (CLIENT_UPDATE_KINDS as readonly string[]).includes(kind);
}

const LABELS: Record<string, string> = {
  opened: "Opened",
  update: "Update sent",
  completed: "Completed",
  status: "Status changed",
  assigned: "Task assigned",
};

/** Human label for an activity row; falls back to the raw kind. */
export function activityLabel(kind: string): string {
  return LABELS[kind] ?? kind;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/job-activity.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/job-activity.ts lib/job-activity.test.ts
git commit -m "feat(jobs): pure activity-kind helpers

One tested place decides which job_updates kinds are client-facing, so the
client panel cannot start showing internal events by accident.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Data layer — pinned and comments

**Files:**
- Modify: `lib/views/jobs.ts` (`JobCard`, `JobDetail`, `getJobBoard`, `getJobDetail`)

**Interfaces:**
- Consumes: `jobs.pinned` and `job_comments` from Task 1.
- Produces:
  - `JobCard` gains `pinned: boolean`
  - `type JobComment = { id: string; body: string; author: string | null; createdAt: string }`
  - `JobDetail` gains `pinned: boolean` and `comments: JobComment[]`
  - `getJobBoard()` orders **pinned first**, then `board_position`, then `updated_at` desc

**Ordering matters more than it looks.** `moveJob` computes a drop index against
its own query of the column. If the board renders pinned-first but `moveJob`
orders only by `board_position`, the two lists disagree and a drag lands in the
wrong place. Task 4 changes `moveJob` to match — the two orderings must stay
identical.

- [ ] **Step 1: Add `pinned` to JobCard**

In `lib/views/jobs.ts`, in the `JobCard` type, add immediately after `assignees`:

```ts
  pinned: boolean;
```

- [ ] **Step 2: Select and order by pinned in getJobBoard**

In `getJobBoard`, replace the `jobs` query with:

```ts
    supabase
      .from("jobs")
      .select("id, client_id, title, owner_profile_id, status, waiting_note, quote_id, due_date, board_position, pinned, updated_at")
      .order("pinned", { ascending: false })
      .order("board_position", { ascending: true })
      .order("updated_at", { ascending: false }),
```

- [ ] **Step 3: Map it onto the card**

In the same function's returned object, add immediately after the `assignees` entry:

```ts
      pinned: j.pinned,
```

- [ ] **Step 4: Add the comment type and detail fields**

In `lib/views/jobs.ts`, add after the `JobUpdate` type:

```ts
export type JobComment = { id: string; body: string; author: string | null; createdAt: string };
```

In the `JobDetail` type, add after `dueDate`:

```ts
  pinned: boolean;
  comments: JobComment[];
```

- [ ] **Step 5: Fetch comments in getJobDetail**

In `getJobDetail`, add a sixth entry to the `Promise.all` array, after the
`profiles` query:

```ts
    supabase.from("job_comments").select("id, body, author_profile_id, created_at").eq("job_id", id).order("created_at"),
```

and widen the destructuring to match — it becomes:

```ts
  const [{ data: client }, { data: tasks }, { data: updates }, { data: profiles }, quoteRes, { data: comments }] = await Promise.all([
```

Note the order: `quoteRes` stays where it is, and the comments entry goes last in
both the destructuring and the array.

- [ ] **Step 6: Map the new fields onto the detail**

In `getJobDetail`'s returned object, add after the `dueDate` line:

```ts
    pinned: j.pinned,
    comments: (comments ?? []).map((c) => ({
      id: c.id,
      body: c.body,
      author: emailLabel(em.get(c.author_profile_id ?? "")),
      createdAt: c.created_at,
    })),
```

`getJobDetail` selects `*`, so `pinned` needs no query change.

- [ ] **Step 7: Verify build and suite**

Run: `npm run build`
Expected: `✓ Compiled successfully`. A `never` type error means Task 1's type
regeneration did not run.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add lib/views/jobs.ts
git commit -m "feat(jobs): expose pinned and staff comments in the data layer

Board now orders pinned cards first. moveJob's ordering is aligned in the next
commit — the two must match or drag indices land wrong.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Actions — comments, pin, activity logging

**Files:**
- Modify: `app/(admin)/admin/jobs/actions.ts`

**Interfaces:**
- Consumes: `job_comments`, `jobs.pinned`, the extended kind constraint (Task 1);
  the pinned-first board ordering (Task 3).
- Produces:
  - `addJobComment(jobId: string, body: string): Promise<void>`
  - `deleteJobComment(commentId: string, jobId: string): Promise<void>`
  - `toggleJobPinned(jobId: string, pinned: boolean): Promise<void>`
  - `applyStatusChange` additionally writes a `'status'` row
  - `setTaskAssignee` additionally writes an `'assigned'` row

- [ ] **Step 1: Align moveJob's column ordering with the board**

Still in `app/(admin)/admin/jobs/actions.ts`, in `moveJob`, replace the column
query so it orders exactly as `getJobBoard` now does:

```ts
  const { data: column } = await supabase
    .from("jobs")
    .select("id")
    .eq("status", toStatus)
    // Must match getJobBoard's ordering (pinned, then position, then recency) —
    // the drop index is computed against what the user sees.
    .order("pinned", { ascending: false })
    .order("board_position", { ascending: true })
    .order("updated_at", { ascending: false });
```

- [ ] **Step 2: Log status changes in the shared path**

In `applyStatusChange`, replace the trailing `if (justCompleted) { ... }` block
with the following. The `completed` row is unchanged; a `status` row is added for
every other transition so the trail records the move without duplicating the
completion entry:

```ts
  if (justCompleted) {
    let emailed = 0;
    try {
      emailed = await notifyJobCompleted({ clientId: job.client_id, title: job.title, ownerProfileId: job.owner_profile_id });
    } catch (e) {
      console.error("job completed email failed:", e);
    }
    await supabase.from("job_updates").insert({ job_id: jobId, kind: "completed", posted_by_profile_id: actorId, emailed_count: emailed });
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
```

- [ ] **Step 3: Log assignment changes**

`setTaskAssignee` currently discards the result of its guard — its first line is
`await staff();`. Change that line to keep the actor:

```ts
  const me = await staff();
```

Then, inside the existing `if (assignee && assigneeProfileId !== task.assignee_profile_id) { ... }`
block, add an activity row immediately after the `notifyTaskAssigned` try/catch —
so a failed email still leaves a record that the assignment happened:

```ts
    await supabase.from("job_updates").insert({
      job_id: jobId,
      kind: "assigned",
      body: `${task.label} → ${assignee.email}`,
      posted_by_profile_id: me.id,
      emailed_count: 0,
    });
```

- [ ] **Step 4: Add the comment and pin actions**

Append to `app/(admin)/admin/jobs/actions.ts`:

```ts
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
```

- [ ] **Step 5: Verify build and suite**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add "app/(admin)/admin/jobs/actions.ts"
git commit -m "feat(jobs): comments, pinning, and activity logging

Status changes and task reassignments now leave a job_updates row, so the job
page can show what actually happened. moveJob's column ordering is aligned with
the board's new pinned-first sort.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Board — pinned highlight

**Files:**
- Modify: `app/(admin)/admin/jobs/JobBoard.tsx`

**Interfaces:**
- Consumes: `JobCard.pinned` (Task 3).
- Produces: pinned cards render with a visible highlight. Ordering already comes
  from `getJobBoard`.

**Do not add a pin button to the card.** The card is simultaneously a link and a
drag handle, and that collision has already caused one production bug (a drag
that only opened the card). A third interactive element inside it is not worth
the risk — the pin toggle lives on the detail page (Task 6).

- [ ] **Step 1: Highlight pinned cards**

In `app/(admin)/admin/jobs/JobBoard.tsx`, inside `SortableCard`, replace the
`<Link>`'s `className` with a pinned-aware one. Use solid design tokens, not
Tailwind opacity modifiers (`warn-ink/40`) — these are custom theme colours and
the modifier form is not guaranteed to resolve:

```tsx
        className={`block rounded-lg border bg-card p-3 transition-colors ${
          card.pinned ? "border-warn-ink" : "border-line hover:border-faint"
        }`}
```

- [ ] **Step 2: Add a pin marker to the card's tag row**

In the same component, immediately before the `{card.fromQuote && (` line, add:

```tsx
          {card.pinned && (
            <span className="rounded bg-warn-tint px-1.5 py-0.5 text-[11px] font-semibold text-warn-ink" title="Pinned">
              ★ Pinned
            </span>
          )}
```

- [ ] **Step 3: Verify build and suite**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/jobs/JobBoard.tsx"
git commit -m "feat(jobs): highlight pinned cards on the board

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Detail page — comments, activity, pin toggle

**Files:**
- Create: `app/(admin)/admin/jobs/[id]/JobComments.tsx`
- Create: `app/(admin)/admin/jobs/[id]/JobPinControl.tsx`
- Modify: `app/(admin)/admin/jobs/[id]/page.tsx`

**Interfaces:**
- Consumes: `addJobComment`, `deleteJobComment`, `toggleJobPinned` (Task 4);
  `JobDetail.comments`, `JobDetail.pinned` (Task 3); `isClientUpdate`,
  `activityLabel` (Task 2).
- Produces: the finished Phase 3 UI.

- [ ] **Step 1: Create the comment thread**

Create `app/(admin)/admin/jobs/[id]/JobComments.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addJobComment, deleteJobComment } from "../actions";
import type { JobComment } from "@/lib/views/jobs";

const fmtTs = (ts: string) => ts.replace("T", " ").slice(0, 16);

/** Internal staff discussion. Never emailed, never shown to a client. */
export function JobComments({ jobId, comments }: { jobId: string; comments: JobComment[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  const post = () => {
    if (!body.trim()) return;
    const value = body;
    setBody("");
    run(() => addJobComment(jobId, value));
  };

  return (
    <div>
      <div className="divide-y divide-line-soft">
        {comments.map((c) => (
          <div key={c.id} className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold capitalize text-ink">{c.author ?? "—"}</span>
              <span className="ml-auto text-xs text-faint">{fmtTs(c.createdAt)}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => deleteJobComment(c.id, jobId))}
                className="shrink-0 text-faint hover:text-brand disabled:opacity-60"
                aria-label="Delete comment"
              >
                ✕
              </button>
            </div>
            <div className="mt-0.5 whitespace-pre-wrap text-[13.5px] text-ink-2">{c.body}</div>
          </div>
        ))}
        {comments.length === 0 && <div className="px-4 py-3 text-xs text-faint">No comments yet.</div>}
      </div>

      <div className="border-t border-line-soft px-4 py-3">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Add a comment for the team…"
          className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-faint"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-[11px] text-faint">Internal only &mdash; the client never sees this.</span>
          <button
            type="button"
            disabled={pending || !body.trim()}
            onClick={post}
            className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
          >
            {pending ? "Posting…" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the pin toggle**

Create `app/(admin)/admin/jobs/[id]/JobPinControl.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toggleJobPinned } from "../actions";

/** Golden ticket — floats this job to the top of its board column. */
export function JobPinControl({ jobId, pinned }: { jobId: string; pinned: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await toggleJobPinned(jobId, !pinned);
          router.refresh();
        })
      }
      className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
        pinned ? "bg-warn-tint text-warn-ink" : "border border-line text-ink-2 hover:bg-line-soft"
      }`}
      aria-pressed={pinned}
    >
      {pinned ? "★ Pinned" : "☆ Pin to top"}
    </button>
  );
}
```

- [ ] **Step 3: Wire the detail page**

In `app/(admin)/admin/jobs/[id]/page.tsx`:

Replace the `KIND_LABEL` constant at line 12 with an import — delete the line:

```ts
const KIND_LABEL: Record<string, string> = { opened: "Opened", completed: "Completed", update: "Update sent" };
```

and add to the imports at the top:

```tsx
import { isClientUpdate, activityLabel } from "@/lib/job-activity";
import { JobComments } from "./JobComments";
import { JobPinControl } from "./JobPinControl";
```

In `UpdateRow`, replace the label lookup:

```tsx
        <span className="font-medium text-ink">{activityLabel(u.kind)}</span>
```

After the `const [assignees, { staff }] = await Promise.all(...)` line, add the
client-facing split (the Activity card uses `job.updates` directly, so it needs
no alias):

```tsx
  const clientUpdates = job.updates.filter((u) => isClientUpdate(u.kind));
```

- [ ] **Step 4: Render the pin toggle beside the title**

The existing `<PageHeader ... />` spans several lines: it opens with
`<PageHeader`, carries `breadcrumb`, `title` and `subtitle` props, and closes with
a line containing only `/>`. Wrap that whole element in a flex row and put the
toggle after it, so the result reads:

```tsx
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          breadcrumb={
            <Link href="/admin/jobs" className="hover:text-ink">
              ← Jobs
            </Link>
          }
          title={job.title}
          subtitle={
            <span>
              {job.clientName}
              {job.quoteNumber && (
                <>
                  {" · from "}
                  <Link href={`/admin/quotes/${job.quoteId}`} className="text-brand hover:text-brand-dark">
                    {job.quoteNumber}
                  </Link>
                </>
              )}
            </span>
          }
        />
        <JobPinControl jobId={job.id} pinned={job.pinned} />
      </div>
```

Keep the existing prop values exactly as they are — the only changes are the
wrapping `<div>` and the added `<JobPinControl />`.

- [ ] **Step 5: Add the comments card and swap the updates panel**

In the left-hand column, immediately after the closing `</Card>` of the Checklist
card, add:

```tsx
          <Card>
            <CardHeader title="Comments" count={job.comments.length} />
            <JobComments jobId={job.id} comments={job.comments} />
          </Card>
```

In the right-hand column, change the Client updates card to use the filtered
list — replace its three references to `job.updates`:

```tsx
            <CardHeader title="Client updates" count={clientUpdates.length} />
            <div className="border-b border-line-soft px-4 py-3.5">
              <PostUpdate jobId={job.id} />
            </div>
            {clientUpdates.length === 0 ? (
              <div className="px-4 py-4 text-xs text-faint">Nothing sent yet.</div>
            ) : (
              clientUpdates.map((u) => <UpdateRow key={u.id} u={u} />)
            )}
```

Then, after that `</Card>`, add the activity card:

```tsx
          <Card>
            <CardHeader title="Activity" count={job.updates.length} />
            {job.updates.length === 0 ? (
              <div className="px-4 py-4 text-xs text-faint">Nothing yet.</div>
            ) : (
              job.updates.map((u) => <UpdateRow key={u.id} u={u} />)
            )}
          </Card>
```

- [ ] **Step 6: Verify build and suite**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 7: Verify in the browser**

Start the dev server with the preview tools (`preview_start` with the
`dashboard-v2` launch config) — **never `npm run dev` in Bash**. On a job detail page, confirm:
1. A comment can be posted and appears with your name and timestamp.
2. A comment can be deleted.
3. "Pin to top" toggles to "★ Pinned", and the card shows the pinned marker and highlight on `/admin/jobs`.
4. Changing the status (via the status buttons) adds a "Status changed" row to **Activity** and does **not** add one to **Client updates**.
5. "Client updates" still shows only Opened / Update sent / Completed rows.

Report what you actually observed, with real values — not just that the checks passed.

Note: drag-and-drop cannot be exercised through browser automation here, and the
browser console may hold stale errors from earlier loads in the same tab — judge
the live DOM and only report a console error that reproduces on a fresh load.

- [ ] **Step 8: Commit**

```bash
git add "app/(admin)/admin/jobs/[id]/JobComments.tsx" "app/(admin)/admin/jobs/[id]/JobPinControl.tsx" "app/(admin)/admin/jobs/[id]/page.tsx"
git commit -m "feat(jobs): staff comments, pin toggle, and activity trail on the job page

Client updates now filters to client-facing kinds via the tested isClientUpdate,
so internal status and assignment events stay out of the panel that records what
the client was told.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done criteria

- [ ] `npx vitest run` passes, including 6 new `job-activity` tests.
- [ ] `npm run build` compiles cleanly.
- [ ] Staff comments can be posted and deleted; they never appear in the client panel.
- [ ] Pinning floats a job to the top of its column and highlights the card.
- [ ] Status changes and reassignments appear under **Activity**, not under **Client updates**.
- [ ] **Nothing pushed** — the branch carries another workstream's unpushed commits.

## Out of scope

@mentions in comments; emailing comments; editing a posted comment; pinning from
the board card; per-task due dates; anything from Phases 1 and 2.
