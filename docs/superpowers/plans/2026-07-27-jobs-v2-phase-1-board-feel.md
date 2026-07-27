# Jobs v2 — Phase 1: Board Feel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin Jobs board draggable and date-aware — drag cards between columns to change status, drag within a column to reorder, and show overdue/due-soon badges from a new job-level due date.

**Architecture:** The board page stays a server component that fetches data and passes it into a new `JobBoard` client component wrapping dnd-kit. A drag that changes column delegates into the *same* internal status-change path the existing buttons use, so the client completion email can never be skipped. Ordering within a column is persisted as `jobs.board_position`, renumbered 0..n-1 on each drop by a pure helper.

**Tech Stack:** Next.js 16 (App Router), React 19, Supabase (Postgres + RLS), Tailwind v4, TypeScript, vitest, `@dnd-kit/*`.

**Spec:** `docs/superpowers/specs/2026-07-27-jobs-v2-design.md` (Phase 1 section).

## Global Constraints

- Supabase project ref is `eskhokedsximnslgsycs`. Never point at `qomxwxxulxcwnpaqzudl`.
- All work happens on `main`. Do not create a `preview` branch.
- Conventional commit messages. End every commit message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Server reads use `lib/supabase/server` (RLS-scoped). Service-role
  (`lib/supabase/service`) is server-only and never shipped to the client.
- Server actions start with `"use server"` and guard with the existing `staff()` check.
- Emails are best-effort: wrapped in try/catch, never blocking an action.
- **Client components must import from `lib/views/*` with `import type` only.**
  Importing a runtime value from that server-coupled module breaks the build.
  Runtime constants needed on the client must be redefined locally.
  `lib/job-board-helpers.ts` is pure (no Supabase import) and *is* safe to import
  as a runtime value from a client component.
- Design tokens: `bg-card`, `border-line`, `text-ink/ink-2/ink-3`, `text-muted`,
  `text-faint`, `text-brand` (#D7141C), `text-good`, `bg-warn-tint`/`text-warn-ink`,
  `bg-line-soft`. Reuse `PageHeader`, `Card`, `CardHeader`, `initials` from `@/components/ui`.
- After any schema change, regenerate types or `.from("...")` is typed `never`:
  `supabase gen types typescript --linked > lib/types/database.ts`
- Dates are handled as `YYYY-MM-DD` strings. Business timezone is `Africa/Johannesburg`.
- Verify with `npx vitest run` and `npm run build` before every commit.

---

### Task 1: Schema + dependencies

Adds the two columns Phase 1 needs and installs dnd-kit. Ends with a green build
against regenerated types.

**Files:**
- Create: `supabase/migrations/0057_jobs_board.sql`
- Modify: `lib/types/database.ts` (regenerated, not hand-edited)
- Modify: `package.json`, `package-lock.json` (via npm install)

**Interfaces:**
- Consumes: nothing.
- Produces: `jobs.due_date` (`date`, nullable) and `jobs.board_position`
  (`int not null default 0`) available on the `jobs` row type; `@dnd-kit/core`,
  `@dnd-kit/sortable`, `@dnd-kit/utilities` importable.

- [ ] **Step 1: Confirm the migration number is still free**

Run: `ls supabase/migrations | tail -5`

Expected: the highest existing number is `0056_supplier_clarification.sql`. If a
newer migration exists, use the next free number instead of `0057` and use that
number consistently for the rest of this task.

- [ ] **Step 2: Create the migration**

Create `supabase/migrations/0057_jobs_board.sql`:

```sql
-- Jobs v2 phase 1: a job-level target date, and manual ordering within a board
-- column. board_position is renumbered 0..n-1 across a column on every drop, so
-- gaps never accumulate.
alter table public.jobs add column due_date date;
alter table public.jobs add column board_position int not null default 0;

create index jobs_status_position_idx on public.jobs (status, board_position);
```

- [ ] **Step 3: Apply the migration**

Run: `supabase db push --linked`
Expected: output lists `0057_jobs_board.sql` as applied, no errors.

- [ ] **Step 4: Regenerate database types**

Run: `supabase gen types typescript --linked > lib/types/database.ts`

- [ ] **Step 5: Verify the new columns are in the generated types**

Run: `grep -n "board_position\|due_date" lib/types/database.ts | head`
Expected: at least one match each for `board_position` and `due_date`.

- [ ] **Step 6: Install dnd-kit**

Run: `npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities`

- [ ] **Step 7: Verify the build still passes**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0057_jobs_board.sql lib/types/database.ts package.json package-lock.json
git commit -m "feat(jobs): add due_date and board_position, install dnd-kit

Schema and dependency groundwork for the draggable, date-aware Jobs board.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Pure board helpers

All date and ordering logic lives in one pure module so it is testable without a
database and safe to import from a client component.

**Files:**
- Create: `lib/job-board-helpers.ts`
- Test: `lib/job-board-helpers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type DueState = "overdue" | "due_soon" | "none"`
  - `dueState(dueDate: string | null, today: string): DueState`
  - `placeCard(orderedIds: string[], movedId: string, toIndex: number): { id: string; position: number }[]`
  - `toDateString(d: Date, timeZone?: string): string`

- [ ] **Step 1: Write the failing tests**

Create `lib/job-board-helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dueState, placeCard, toDateString } from "./job-board-helpers";

describe("dueState", () => {
  it("is 'none' when there is no due date", () => {
    expect(dueState(null, "2026-07-27")).toBe("none");
  });
  it("is 'overdue' when the date has passed", () => {
    expect(dueState("2026-07-26", "2026-07-27")).toBe("overdue");
  });
  it("is 'due_soon' today and within two days", () => {
    expect(dueState("2026-07-27", "2026-07-27")).toBe("due_soon");
    expect(dueState("2026-07-29", "2026-07-27")).toBe("due_soon");
  });
  it("is 'none' further out than two days", () => {
    expect(dueState("2026-07-30", "2026-07-27")).toBe("none");
  });
  it("handles month and year boundaries", () => {
    expect(dueState("2026-08-01", "2026-07-31")).toBe("due_soon");
    expect(dueState("2025-12-31", "2026-01-01")).toBe("overdue");
  });
});

describe("placeCard", () => {
  it("inserts a new card at the top of a column", () => {
    expect(placeCard(["a", "b"], "x", 0)).toEqual([
      { id: "x", position: 0 },
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ]);
  });
  it("inserts into the middle", () => {
    expect(placeCard(["a", "b"], "x", 1)).toEqual([
      { id: "a", position: 0 },
      { id: "x", position: 1 },
      { id: "b", position: 2 },
    ]);
  });
  it("clamps an index past the end", () => {
    expect(placeCard(["a", "b"], "x", 99)).toEqual([
      { id: "a", position: 0 },
      { id: "b", position: 1 },
      { id: "x", position: 2 },
    ]);
  });
  it("clamps a negative index", () => {
    expect(placeCard(["a"], "x", -3)).toEqual([
      { id: "x", position: 0 },
      { id: "a", position: 1 },
    ]);
  });
  it("reorders within the same column without duplicating the moved card", () => {
    expect(placeCard(["a", "b", "c"], "c", 0)).toEqual([
      { id: "c", position: 0 },
      { id: "a", position: 1 },
      { id: "b", position: 2 },
    ]);
  });
  it("handles dropping into an empty column", () => {
    expect(placeCard([], "x", 0)).toEqual([{ id: "x", position: 0 }]);
  });
});

describe("toDateString", () => {
  it("formats a date as YYYY-MM-DD in the business timezone", () => {
    // 22:30 UTC on 27 Jul is already 00:30 on 28 Jul in Johannesburg (UTC+2).
    expect(toDateString(new Date("2026-07-27T22:30:00Z"))).toBe("2026-07-28");
  });
  it("respects an explicit timezone", () => {
    expect(toDateString(new Date("2026-07-27T22:30:00Z"), "UTC")).toBe("2026-07-27");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/job-board-helpers.test.ts`
Expected: FAIL — cannot resolve `./job-board-helpers`.

- [ ] **Step 3: Write the implementation**

Create `lib/job-board-helpers.ts`:

```ts
// Pure helpers for the Jobs board. No Supabase import — safe to use from both
// server and client components.

export type DueState = "overdue" | "due_soon" | "none";

/** Cards due today or within this many days read as "due soon". */
const DUE_SOON_DAYS = 2;
const DAY_MS = 86_400_000;

/** Whole days from `a` to `b`, both YYYY-MM-DD. Timezone-independent. */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** How a job's due date should read on its card, relative to `today`. */
export function dueState(dueDate: string | null, today: string): DueState {
  if (!dueDate) return "none";
  const diff = daysBetween(today, dueDate);
  if (diff < 0) return "overdue";
  if (diff <= DUE_SOON_DAYS) return "due_soon";
  return "none";
}

/**
 * Place `movedId` at `toIndex` within a column and renumber the whole column
 * 0..n-1. Works whether the card is arriving from another column or moving
 * within this one (it is removed first either way), and clamps out-of-range
 * indexes. Renumbering everything keeps positions gap-free.
 */
export function placeCard(
  orderedIds: string[],
  movedId: string,
  toIndex: number,
): { id: string; position: number }[] {
  const without = orderedIds.filter((id) => id !== movedId);
  const at = Math.max(0, Math.min(toIndex, without.length));
  const next = [...without.slice(0, at), movedId, ...without.slice(at)];
  return next.map((id, position) => ({ id, position }));
}

/** A Date as YYYY-MM-DD in the business timezone (en-CA formats as ISO). */
export function toDateString(d: Date, timeZone = "Africa/Johannesburg"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/job-board-helpers.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/job-board-helpers.ts lib/job-board-helpers.test.ts
git commit -m "feat(jobs): pure board helpers for due state and card placement

dueState, placeCard and toDateString with full unit coverage. No Supabase
import, so the board's client component can use them directly.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Surface the new fields in the data layer

**Files:**
- Modify: `lib/views/jobs.ts` (the `JobCard` type at lines 15-26, and `getJobBoard` at lines 58-91)

**Interfaces:**
- Consumes: `jobs.due_date`, `jobs.board_position` from Task 1.
- Produces: `JobCard` gains `dueDate: string | null` and `boardPosition: number`.
  `getJobBoard()` returns cards ordered by `board_position` ascending, then
  `updated_at` descending.

- [ ] **Step 1: Add the two fields to the JobCard type**

In `lib/views/jobs.ts`, replace the `JobCard` type:

```ts
export type JobCard = {
  id: string;
  title: string;
  clientName: string;
  status: JobStatus;
  ownerLabel: string | null;
  taskTotal: number;
  taskDone: number;
  waitingNote: string | null;
  fromQuote: boolean;
  dueDate: string | null;
  boardPosition: number;
  updatedAt: string;
};
```

- [ ] **Step 2: Select and order by the new columns**

In `getJobBoard`, replace the `jobs` query (currently line 62) with:

```ts
    supabase
      .from("jobs")
      .select("id, client_id, title, owner_profile_id, status, waiting_note, quote_id, due_date, board_position, updated_at")
      .order("board_position", { ascending: true })
      .order("updated_at", { ascending: false }),
```

- [ ] **Step 3: Map the new fields onto the card**

In the same function, in the returned object literal, add the two fields
immediately before `updatedAt`:

```ts
      fromQuote: !!j.quote_id,
      dueDate: j.due_date,
      boardPosition: j.board_position,
      updatedAt: j.updated_at,
```

- [ ] **Step 4: Verify the build passes**

Run: `npm run build`
Expected: `✓ Compiled successfully`. A `never` type error here means Task 1's
type regeneration did not run — rerun it before continuing.

- [ ] **Step 5: Commit**

```bash
git add lib/views/jobs.ts
git commit -m "feat(jobs): expose due date and board position on board cards

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Server actions — shared status path, moveJob, setJobDueDate

The critical task. `setJobStatus` and the new `moveJob` must run one status-change
code path; duplicating it would let a drag to Done silently skip the client
completion email.

**Files:**
- Modify: `app/(admin)/admin/jobs/actions.ts` (replace `setJobStatus` at lines 78-106; append two new actions)

**Interfaces:**
- Consumes: `placeCard` from Task 2.
- Produces:
  - `moveJob(jobId: string, toStatus: JobStatus, toIndex: number): Promise<void>`
  - `setJobDueDate(jobId: string, dueDate: string | null): Promise<void>`
  - `setJobStatus` keeps its existing signature `(jobId, status, waitingNote)`.

- [ ] **Step 1: Import the placement helper**

In `app/(admin)/admin/jobs/actions.ts`, add below the existing
`import { reorderSwap } from "@/lib/job-task-helpers";` line:

```ts
import { placeCard } from "@/lib/job-board-helpers";
```

- [ ] **Step 2: Extract the shared status-change core**

Replace the whole existing `setJobStatus` function (lines 78-106) with the
private core plus a thin public action:

```ts
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
    let emailed = 0;
    try {
      emailed = await notifyJobCompleted({ clientId: job.client_id, title: job.title, ownerProfileId: job.owner_profile_id });
    } catch (e) {
      console.error("job completed email failed:", e);
    }
    await supabase.from("job_updates").insert({ job_id: jobId, kind: "completed", posted_by_profile_id: actorId, emailed_count: emailed });
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
```

- [ ] **Step 3: Verify the refactor did not change behaviour**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

Run: `npx vitest run`
Expected: all existing tests pass (73 at time of writing).

- [ ] **Step 4: Commit the refactor on its own**

Committing the pure refactor separately keeps it reviewable against the new behaviour.

```bash
git add "app/(admin)/admin/jobs/actions.ts"
git commit -m "refactor(jobs): extract shared applyStatusChange core

setJobStatus now delegates to a private core so the upcoming board drag can
reuse the exact same transition, emails and activity row.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Add moveJob and setJobDueDate**

Append to the end of `app/(admin)/admin/jobs/actions.ts`:

```ts
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
    .order("board_position", { ascending: true })
    .order("updated_at", { ascending: false });

  const placed = placeCard((column ?? []).map((c) => c.id), jobId, toIndex);
  await Promise.all(
    placed.map((p) => supabase.from("jobs").update({ board_position: p.position }).eq("id", p.id)),
  );

  revalidatePath("/admin/jobs");
  revalidatePath(`/admin/jobs/${jobId}`);
}

/** Set or clear a job's target date. No email. */
export async function setJobDueDate(jobId: string, dueDate: string | null) {
  await staff();
  const supabase = await createClient();
  await supabase
    .from("jobs")
    .update({ due_date: dueDate || null, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  revalidatePath("/admin/jobs");
  revalidatePath(`/admin/jobs/${jobId}`);
}
```

- [ ] **Step 6: Verify the build passes**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 7: Commit**

```bash
git add "app/(admin)/admin/jobs/actions.ts"
git commit -m "feat(jobs): moveJob and setJobDueDate actions

moveJob reuses applyStatusChange for column changes, then renumbers the
destination column via placeCard. setJobDueDate sets the job target date.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Draggable board UI

The board becomes a client component. `page.tsx` keeps the data fetch and passes
`today` down so the due badge cannot cause a server/client hydration mismatch.

**Files:**
- Create: `app/(admin)/admin/jobs/JobBoard.tsx`
- Modify: `app/(admin)/admin/jobs/page.tsx` (replace the board markup and the local `JobCardView`)

**Interfaces:**
- Consumes: `JobCard` type and `getJobBoard` from Task 3; `moveJob` from Task 4;
  `dueState`, `toDateString` from Task 2.
- Produces: `<JobBoard cards={JobCard[]} today={string} />`.

- [ ] **Step 1: Create the board client component**

Create `app/(admin)/admin/jobs/JobBoard.tsx`:

```tsx
"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { initials } from "@/components/ui";
import { dueState } from "@/lib/job-board-helpers";
import { moveJob } from "./actions";
import type { JobCard, JobStatus } from "@/lib/views/jobs";

// Redefined locally: lib/views/jobs is server-coupled, so a client component may
// only import types from it.
const COLUMNS: { status: JobStatus; label: string; dot: string }[] = [
  { status: "todo", label: "To do", dot: "#94A3B8" },
  { status: "in_progress", label: "In progress", dot: "#185FA5" },
  { status: "waiting", label: "Waiting", dot: "#B45309" },
  { status: "done", label: "Done", dot: "#15803D" },
];

export function JobBoard({ cards, today }: { cards: JobCard[]; today: string }) {
  const router = useRouter();
  const [, start] = useTransition();
  // Local copy so the board reorders instantly; the server revalidation follows.
  const [items, setItems] = useState(cards);

  const sensors = useSensors(
    // A small drag threshold so clicking a card still navigates to it.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const columnOf = (id: string) => items.find((c) => c.id === id)?.status;

  const onDragEnd = (e: DragEndEvent) => {
    const activeId = String(e.active.id);
    if (!e.over) return;
    const overId = String(e.over.id);

    const from = columnOf(activeId);
    if (!from) return;

    // Dropped on a column shell (empty column) or on another card.
    const overStatus = COLUMNS.find((c) => c.status === overId)?.status;
    const toStatus = overStatus ?? columnOf(overId);
    if (!toStatus) return;

    const target = items.filter((c) => c.status === toStatus && c.id !== activeId);
    const toIndex = overStatus ? target.length : target.findIndex((c) => c.id === overId);
    const index = toIndex < 0 ? target.length : toIndex;

    setItems((prev) => {
      const moved = prev.find((c) => c.id === activeId);
      if (!moved) return prev;
      const rest = prev.filter((c) => c.id !== activeId);
      const before = rest.filter((c) => c.status !== toStatus);
      const col = rest.filter((c) => c.status === toStatus);
      col.splice(index, 0, { ...moved, status: toStatus });
      return [...before, ...col];
    });

    start(async () => {
      await moveJob(activeId, toStatus, index);
      router.refresh();
    });
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const colCards = items.filter((c) => c.status === col.status);
          return (
            <Column key={col.status} status={col.status} label={col.label} dot={col.dot} count={colCards.length}>
              <SortableContext items={colCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {colCards.map((c) => (
                  <SortableCard key={c.id} card={c} today={today} />
                ))}
              </SortableContext>
              {colCards.length === 0 && (
                <div className="px-1 py-6 text-center text-xs text-faint">Nothing here</div>
              )}
            </Column>
          );
        })}
      </div>
    </DndContext>
  );
}

function Column({
  status,
  label,
  dot,
  count,
  children,
}: {
  status: JobStatus;
  label: string;
  dot: string;
  count: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border p-2.5 transition-colors ${isOver ? "border-faint bg-line-soft" : "border-line bg-[#FCFCFD]"}`}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="h-[7px] w-[7px] rounded-full" style={{ background: dot }} />
        <span className="text-[12.5px] font-semibold text-ink">{label}</span>
        <span className="ml-auto text-[11px] text-faint">{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SortableCard({ card, today }: { card: JobCard; today: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const due = dueState(card.dueDate, today);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={`touch-none ${isDragging ? "opacity-50" : ""}`}
    >
      <Link
        href={`/admin/jobs/${card.id}`}
        className="block rounded-lg border border-line bg-card p-3 transition-colors hover:border-faint"
      >
        <div className="text-[13px] font-semibold leading-snug text-ink">{card.title}</div>
        <div className="mt-0.5 truncate text-xs text-muted">{card.clientName}</div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {card.ownerLabel && (
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink text-[10px] font-semibold uppercase text-white"
              title={card.ownerLabel}
            >
              {initials(card.ownerLabel)}
            </span>
          )}
          {card.taskTotal > 0 && (
            <span className="text-[11px] text-faint">
              {card.taskDone}/{card.taskTotal} done
            </span>
          )}
          {due === "overdue" && (
            <span className="rounded bg-[#FEE2E2] px-1.5 py-0.5 text-[11px] font-semibold text-[#B91C1C]">Overdue</span>
          )}
          {due === "due_soon" && (
            <span className="rounded bg-warn-tint px-1.5 py-0.5 text-[11px] text-warn-ink">Due soon</span>
          )}
          {card.fromQuote && (
            <span className="rounded bg-line-soft px-1.5 py-0.5 text-[11px] text-ink-3">from quote</span>
          )}
          {card.status === "waiting" && card.waitingNote && (
            <span className="rounded bg-warn-tint px-1.5 py-0.5 text-[11px] text-warn-ink">{card.waitingNote}</span>
          )}
          {/* Dragging into Waiting leaves the note empty — prompt for it here
              rather than blocking the drag with a modal. Opens the job, where
              JobStatusControl already has the input. */}
          {card.status === "waiting" && !card.waitingNote && (
            <span className="rounded border border-dashed border-line px-1.5 py-0.5 text-[11px] text-faint">
              + what&rsquo;s it waiting on?
            </span>
          )}
        </div>
      </Link>
    </div>
  );
}
```

- [ ] **Step 2: Slim down the board page**

Replace the entire contents of `app/(admin)/admin/jobs/page.tsx` with:

```tsx
import { getJobBoard, getJobFormOptions } from "@/lib/views/jobs";
import { toDateString } from "@/lib/job-board-helpers";
import { PageHeader } from "@/components/ui";
import { NewJobDialog } from "./NewJobDialog";
import { JobBoard } from "./JobBoard";

export default async function AdminJobsPage() {
  const [cards, { clients, staff }] = await Promise.all([getJobBoard(), getJobFormOptions()]);
  // Computed server-side so the due badge renders identically on both sides.
  const today = toDateString(new Date());

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Jobs" subtitle="Work in progress across all clients." />
        <NewJobDialog clients={clients} staff={staff} />
      </div>

      <JobBoard cards={cards} today={today} />
    </div>
  );
}
```

- [ ] **Step 3: Verify the build passes**

Run: `npm run build`
Expected: `✓ Compiled successfully`. If it fails with an error about importing a
server module into a client component, check that `JobBoard.tsx` imports
`JobCard`/`JobStatus` with `import type` and does not import `BOARD_STATUSES` or
`JOB_STATUS_LABEL`.

- [ ] **Step 4: Verify in the browser**

Start the dev server with the preview tool (never `npm run dev` in Bash), open
`/admin/jobs`, then confirm:
1. All four columns render with their existing counts.
2. Clicking a card still navigates to the job detail page.
3. Dragging a card to another column moves it and it stays there after refresh.
4. Dragging within a column reorders it and the order survives a refresh.
5. `read_console_messages` reports no errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/jobs/JobBoard.tsx" "app/(admin)/admin/jobs/page.tsx"
git commit -m "feat(jobs): drag-and-drop board with due badges

Board moves into a dnd-kit client component: drag between columns to change
status, drag within a column to reorder. Cards show overdue/due-soon badges.
A 5px drag threshold keeps click-through to the job working.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Due-date editor on the job detail page

**Files:**
- Create: `app/(admin)/admin/jobs/[id]/JobDueDate.tsx`
- Modify: `lib/views/jobs.ts` (the `JobDetail` type and `getJobDetail`'s return)
- Modify: `app/(admin)/admin/jobs/[id]/page.tsx` (render the new control)

**Interfaces:**
- Consumes: `setJobDueDate` from Task 4.
- Produces: `JobDetail` gains `dueDate: string | null`;
  `<JobDueDate jobId={string} dueDate={string | null} />`.

- [ ] **Step 1: Add dueDate to the JobDetail type**

In `lib/views/jobs.ts`, in the `JobDetail` type, add after `waitingNote`:

```ts
  dueDate: string | null;
```

- [ ] **Step 2: Return it from getJobDetail**

In `getJobDetail`'s returned object, add after the `waitingNote` line:

```ts
    dueDate: j.due_date,
```

`getJobDetail` selects `*`, so no query change is needed.

- [ ] **Step 3: Create the control**

Create `app/(admin)/admin/jobs/[id]/JobDueDate.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobDueDate } from "../actions";

/** Target date for the whole job. Drives the board's overdue / due-soon badges. */
export function JobDueDate({ jobId, dueDate }: { jobId: string; dueDate: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">Due</span>
      <input
        type="date"
        defaultValue={dueDate ?? ""}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await setJobDueDate(jobId, e.target.value || null);
            router.refresh();
          })
        }
        className="ml-auto rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint disabled:opacity-60"
        aria-label="Job due date"
      />
    </div>
  );
}
```

- [ ] **Step 4: Render it on the detail page**

In `app/(admin)/admin/jobs/[id]/page.tsx`, add the import beside the existing
`JobOwnerControl` import:

```tsx
import { JobDueDate } from "./JobDueDate";
```

Then render it directly after the existing `<JobOwnerControl ... />` line:

```tsx
          <JobDueDate jobId={job.id} dueDate={job.dueDate} />
```

- [ ] **Step 5: Verify the build and tests pass**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 6: Verify end to end in the browser**

On a job detail page, set a due date of yesterday, return to `/admin/jobs`, and
confirm the card shows a red **Overdue** badge. Change it to two days out and
confirm it reads **Due soon**. Clear it and confirm the badge disappears.

- [ ] **Step 7: Commit**

```bash
git add "app/(admin)/admin/jobs/[id]/JobDueDate.tsx" "app/(admin)/admin/jobs/[id]/page.tsx" lib/views/jobs.ts
git commit -m "feat(jobs): set a job due date from the detail page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done criteria

- [ ] `npx vitest run` passes, including 13 new `job-board-helpers` tests.
- [ ] `npm run build` compiles cleanly.
- [ ] Cards drag between columns; a drag to **Done** sends the client completion
      email and writes a `completed` row exactly as the status button does.
- [ ] Card order within a column survives a page refresh.
- [ ] Clicking a card still opens the job.
- [ ] Overdue and due-soon badges render from the job's due date.
- [ ] Pushed to `main` (triggers the Vercel deploy).

## Deliberately out of scope

Board filters, the "my work" view, the weekly digest (Phase 2); staff comments,
golden ticket and the activity trail (Phase 3); auto-archiving done cards (cut
from the spec as YAGNI).
