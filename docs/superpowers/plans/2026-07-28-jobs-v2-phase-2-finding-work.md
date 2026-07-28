# Jobs v2 — Phase 2: Finding Work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it easy to find your own work — filter the Jobs board by client, owner or assignee, see everything assigned to you on one page, and receive a weekly digest of your open work by email.

**Architecture:** Filtering is pure and server-rendered: `getJobBoard()` gains the ids needed to filter on, a tested pure `filterJobCards` does the work, and the board page drives it from `searchParams` using the same link-pill pattern as `/admin/activity` — no client state. The digest reuses that same shape: one pure, tested content builder (`lib/job-digest.ts`) feeding both a secured route handler and any future on-demand send, so the two can never drift.

**Tech Stack:** Next.js 16 (App Router), React 19, Supabase (Postgres + RLS), Tailwind v4, TypeScript, vitest, Resend.

**Spec:** `docs/superpowers/specs/2026-07-27-jobs-v2-design.md` (Phase 2 section).

**No migration.** Phase 2 is views, UI, one route handler and one pure module.

## Global Constraints

- Supabase project ref is `eskhokedsximnslgsycs`. Never point at `qomxwxxulxcwnpaqzudl`.
- All work happens on `main`. Do not create a `preview` branch.
- Conventional commit messages. End every commit message with:
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- Server reads use `lib/supabase/server` (RLS-scoped). Service-role
  (`lib/supabase/service`) is server-only, used ONLY in the digest route handler,
  and never shipped to the client.
- Server actions start with `"use server"` and guard with the existing `staff()` check.
- Emails are best-effort: wrapped in try/catch, never blocking.
- **Client components must import from `lib/views/*` with `import type` only.**
  `lib/job-board-helpers.ts` and `lib/job-digest.ts` are pure (no Supabase import)
  and ARE safe to import as runtime values anywhere. Keep them that way.
- Design tokens: `bg-card`, `border-line`, `text-ink/ink-2/ink-3`, `text-muted`,
  `text-faint`, `text-brand` (#D7141C), `text-good`, `bg-warn-tint`/`text-warn-ink`,
  `bg-line-soft`, `bg-canvas`. Reuse `PageHeader`, `Card`, `CardHeader`, `initials`
  from `@/components/ui`.
- Dates are `YYYY-MM-DD` strings. Business timezone is `Africa/Johannesburg`.
- Tests are vitest, colocated, RELATIVE imports (`./job-digest`), matching
  `lib/job-board-helpers.test.ts`.
- Verify with `npx vitest run` and `npm run build` before every commit.
- **Do NOT add a Vercel cron entry or create `vercel.json` in this plan.** The user
  decided the digest ships with a manual trigger only; the schedule is a separate
  follow-up once they have reviewed a sample. Building the cron now would start
  emailing the whole team unannounced.

## File structure

| File | Responsibility |
| --- | --- |
| `lib/job-board-helpers.ts` (modify) | add pure `filterJobCards` + `compareByDue` |
| `lib/job-board-helpers.test.ts` (modify) | tests for both |
| `lib/views/jobs.ts` (modify) | `JobCard` gains filterable ids; new `getMyWork` |
| `app/(admin)/admin/jobs/page.tsx` (modify) | filter bar + apply filters |
| `app/(admin)/admin/jobs/mine/page.tsx` (create) | "My work" view |
| `lib/job-digest.ts` (create) | pure digest content builder |
| `lib/job-digest.test.ts` (create) | its tests |
| `lib/job-emails.ts` (modify) | export `sendJobDigest` reusing the existing sender |
| `app/api/jobs/digest/route.ts` (create) | secured trigger: load → build → send |

---

### Task 1: Filterable board data + pure filter

**Files:**
- Modify: `lib/views/jobs.ts` (the `JobCard` type, and `getJobBoard`)
- Modify: `lib/job-board-helpers.ts`
- Modify: `lib/job-board-helpers.test.ts`

**Interfaces:**
- Consumes: nothing from other Phase 2 tasks.
- Produces:
  - `JobCard` gains `clientId: string`, `ownerProfileId: string | null`,
    `assignees: { id: string; label: string }[]`
  - `type JobFilters = { client?: string; owner?: string; assignee?: string; mineProfileId?: string }`
  - `filterJobCards<T extends FilterableCard>(cards: T[], filters: JobFilters): T[]`
  - `compareByDue(a: { dueDate: string | null }, b: { dueDate: string | null }): number`

- [ ] **Step 1: Write the failing tests**

Append to `lib/job-board-helpers.test.ts`:

```ts
import { filterJobCards, compareByDue } from "./job-board-helpers";

const card = (over: Partial<{ id: string; clientId: string; ownerProfileId: string | null; assignees: { id: string }[] }> = {}) => ({
  id: "j1",
  clientId: "c1",
  ownerProfileId: "p1" as string | null,
  assignees: [{ id: "p2" }],
  ...over,
});

describe("filterJobCards", () => {
  it("returns everything when no filters are set", () => {
    const cards = [card(), card({ id: "j2", clientId: "c2" })];
    expect(filterJobCards(cards, {})).toHaveLength(2);
  });
  it("filters by client", () => {
    const cards = [card(), card({ id: "j2", clientId: "c2" })];
    expect(filterJobCards(cards, { client: "c2" }).map((c) => c.id)).toEqual(["j2"]);
  });
  it("filters by owner", () => {
    const cards = [card(), card({ id: "j2", ownerProfileId: "p9" })];
    expect(filterJobCards(cards, { owner: "p9" }).map((c) => c.id)).toEqual(["j2"]);
  });
  it("filters by assignee", () => {
    const cards = [card(), card({ id: "j2", assignees: [{ id: "p9" }] })];
    expect(filterJobCards(cards, { assignee: "p9" }).map((c) => c.id)).toEqual(["j2"]);
  });
  it("combines filters with AND", () => {
    const cards = [
      card({ id: "j1", clientId: "c1", ownerProfileId: "p1" }),
      card({ id: "j2", clientId: "c1", ownerProfileId: "p9" }),
      card({ id: "j3", clientId: "c2", ownerProfileId: "p1" }),
    ];
    expect(filterJobCards(cards, { client: "c1", owner: "p1" }).map((c) => c.id)).toEqual(["j1"]);
  });
  it("'mine' matches jobs I own OR am assigned to", () => {
    const cards = [
      card({ id: "owned", ownerProfileId: "me", assignees: [] }),
      card({ id: "assigned", ownerProfileId: "other", assignees: [{ id: "me" }] }),
      card({ id: "neither", ownerProfileId: "other", assignees: [{ id: "someone" }] }),
    ];
    expect(filterJobCards(cards, { mineProfileId: "me" }).map((c) => c.id)).toEqual(["owned", "assigned"]);
  });
  it("ignores blank filter values", () => {
    expect(filterJobCards([card()], { client: "", owner: "", assignee: "" })).toHaveLength(1);
  });
});

describe("compareByDue", () => {
  it("orders earlier dates first", () => {
    expect(compareByDue({ dueDate: "2026-07-01" }, { dueDate: "2026-07-02" })).toBeLessThan(0);
  });
  it("puts undated items last", () => {
    expect(compareByDue({ dueDate: null }, { dueDate: "2026-07-02" })).toBeGreaterThan(0);
    expect(compareByDue({ dueDate: "2026-07-02" }, { dueDate: null })).toBeLessThan(0);
  });
  it("treats two undated items as equal", () => {
    expect(compareByDue({ dueDate: null }, { dueDate: null })).toBe(0);
  });
  it("sorts a list overdue-first, undated last", () => {
    const list = [{ dueDate: null }, { dueDate: "2026-07-10" }, { dueDate: "2026-07-01" }];
    expect([...list].sort(compareByDue).map((x) => x.dueDate)).toEqual(["2026-07-01", "2026-07-10", null]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/job-board-helpers.test.ts`
Expected: FAIL — `filterJobCards` and `compareByDue` are not exported.

- [ ] **Step 3: Implement the two pure functions**

Append to `lib/job-board-helpers.ts`:

```ts
/** The card shape `filterJobCards` needs. Structural, so it works on any row carrying these. */
export type FilterableCard = {
  clientId: string;
  ownerProfileId: string | null;
  assignees: { id: string }[];
};

/** Board filter selections. Blank strings mean "no filter". */
export type JobFilters = {
  client?: string;
  owner?: string;
  assignee?: string;
  /** When set, keep only jobs this profile owns or is assigned a task on. */
  mineProfileId?: string;
};

/** Apply the board filters. Filters combine with AND; blanks are ignored. */
export function filterJobCards<T extends FilterableCard>(cards: T[], filters: JobFilters): T[] {
  const { client, owner, assignee, mineProfileId } = filters;
  return cards.filter((c) => {
    if (client && c.clientId !== client) return false;
    if (owner && c.ownerProfileId !== owner) return false;
    if (assignee && !c.assignees.some((a) => a.id === assignee)) return false;
    if (mineProfileId && c.ownerProfileId !== mineProfileId && !c.assignees.some((a) => a.id === mineProfileId)) {
      return false;
    }
    return true;
  });
}

/** Sort comparator: soonest due first, undated last. */
export function compareByDue(a: { dueDate: string | null }, b: { dueDate: string | null }): number {
  if (a.dueDate === b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return a.dueDate < b.dueDate ? -1 : 1;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/job-board-helpers.test.ts`
Expected: PASS — the 21 existing tests plus 11 new ones.

- [ ] **Step 5: Add the filterable ids to JobCard**

In `lib/views/jobs.ts`, replace the `JobCard` type:

```ts
export type JobCard = {
  id: string;
  title: string;
  clientId: string;
  clientName: string;
  status: JobStatus;
  ownerProfileId: string | null;
  ownerLabel: string | null;
  assignees: { id: string; label: string }[];
  taskTotal: number;
  taskDone: number;
  waitingNote: string | null;
  fromQuote: boolean;
  dueDate: string | null;
  boardPosition: number;
  updatedAt: string;
};
```

- [ ] **Step 6: Populate them in getJobBoard**

In `getJobBoard`, change the `job_tasks` query to also select the assignee, and
build a per-job assignee list. Replace the `job_tasks` line in the `Promise.all`:

```ts
    supabase.from("job_tasks").select("job_id, done, assignee_profile_id"),
```

Then, after the existing `counts` loop, add an assignee map, and extend the
returned object. The full body after the `Promise.all` becomes:

```ts
  const cn = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const em = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const counts = new Map<string, { t: number; d: number }>();
  const assigneeIds = new Map<string, Set<string>>();
  for (const t of tasks ?? []) {
    const c = counts.get(t.job_id) ?? { t: 0, d: 0 };
    c.t++;
    if (t.done) c.d++;
    counts.set(t.job_id, c);
    if (t.assignee_profile_id) {
      const set = assigneeIds.get(t.job_id) ?? new Set<string>();
      set.add(t.assignee_profile_id);
      assigneeIds.set(t.job_id, set);
    }
  }
  return (jobs ?? []).map((j) => {
    const c = counts.get(j.id) ?? { t: 0, d: 0 };
    return {
      id: j.id,
      title: j.title,
      clientId: j.client_id,
      clientName: cn.get(j.client_id) ?? "—",
      status: j.status as JobStatus,
      ownerProfileId: j.owner_profile_id,
      ownerLabel: emailLabel(em.get(j.owner_profile_id ?? "")),
      assignees: [...(assigneeIds.get(j.id) ?? [])].map((id) => ({
        id,
        label: emailLabel(em.get(id)) ?? id,
      })),
      taskTotal: c.t,
      taskDone: c.d,
      waitingNote: j.waiting_note,
      fromQuote: !!j.quote_id,
      dueDate: j.due_date,
      boardPosition: j.board_position,
      updatedAt: j.updated_at,
    };
  });
```

- [ ] **Step 7: Verify the build and full suite**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

Run: `npx vitest run`
Expected: all pass (202 before this task, plus 11 new).

- [ ] **Step 8: Commit**

```bash
git add lib/views/jobs.ts lib/job-board-helpers.ts lib/job-board-helpers.test.ts
git commit -m "feat(jobs): filterable board data and pure filter helpers

JobCard now carries clientId, ownerProfileId and its distinct task assignees.
New tested filterJobCards and compareByDue helpers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Board filter bar

**Files:**
- Modify: `app/(admin)/admin/jobs/page.tsx`

**Interfaces:**
- Consumes: `filterJobCards`, `JobFilters` from Task 1; `JobCard.clientId`,
  `.ownerProfileId`, `.assignees` from Task 1.
- Produces: the board honours `?client=&owner=&assignee=&mine=1`.

Filter options are derived from the cards actually on the board (so you never
pick a client with no jobs) — the same technique `/admin/activity` uses for its
client dropdown.

- [ ] **Step 1: Rewrite the board page**

Replace the entire contents of `app/(admin)/admin/jobs/page.tsx`:

```tsx
import Link from "next/link";
import { getJobBoard, getJobFormOptions } from "@/lib/views/jobs";
import { toDateString, filterJobCards } from "@/lib/job-board-helpers";
import { getCurrentProfile } from "@/lib/auth/profile";
import { PageHeader } from "@/components/ui";
import { NewJobDialog } from "./NewJobDialog";
import { JobBoard } from "./JobBoard";

const PILL = "rounded-full px-3 py-1 text-[12.5px] font-semibold";
const SELECT = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none";

export default async function AdminJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; owner?: string; assignee?: string; mine?: string }>;
}) {
  const params = await searchParams;
  const [cards, { clients, staff }, me] = await Promise.all([
    getJobBoard(),
    getJobFormOptions(),
    getCurrentProfile(),
  ]);
  // Computed server-side so the due badge renders identically on both sides.
  const today = toDateString(new Date());

  const myId = me.authenticated ? me.profile.id : "";
  const mine = params.mine === "1" && !!myId;
  const filters = {
    client: params.client ?? "",
    owner: params.owner ?? "",
    assignee: params.assignee ?? "",
    mineProfileId: mine ? myId : undefined,
  };
  const visible = filterJobCards(cards, filters);

  // Options come from the cards on the board, so you can never pick an empty filter.
  const clientOptions = [...new Map(cards.map((c) => [c.clientId, c.clientName])).entries()].sort((a, b) =>
    a[1].localeCompare(b[1]),
  );
  const ownerOptions = [
    ...new Map(cards.filter((c) => c.ownerProfileId).map((c) => [c.ownerProfileId!, c.ownerLabel ?? ""])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  const assigneeOptions = [
    ...new Map(cards.flatMap((c) => c.assignees).map((a) => [a.id, a.label])).entries(),
  ].sort((a, b) => a[1].localeCompare(b[1]));

  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({
      client: filters.client,
      owner: filters.owner,
      assignee: filters.assignee,
      mine: mine ? "1" : "",
      ...over,
    });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    const q = p.toString();
    return q ? `/admin/jobs?${q}` : "/admin/jobs";
  };
  const filtered = visible.length !== cards.length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Jobs" subtitle="Work in progress across all clients." />
        <NewJobDialog clients={clients} staff={staff} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ mine: "" })} className={`${PILL} ${!mine ? "bg-ink text-white" : "bg-line-soft text-ink-3 hover:bg-line"}`}>
          All jobs
        </Link>
        <Link href={qs({ mine: "1" })} className={`${PILL} ${mine ? "bg-ink text-white" : "bg-line-soft text-ink-3 hover:bg-line"}`}>
          Just mine
        </Link>
        <Link href="/admin/jobs/mine" className={`${PILL} bg-line-soft text-ink-3 hover:bg-line`}>
          My work →
        </Link>

        <form className="ml-auto flex flex-wrap items-center gap-2" action="/admin/jobs" method="get">
          {mine && <input type="hidden" name="mine" value="1" />}
          <select name="client" defaultValue={filters.client} className={SELECT}>
            <option value="">All clients</option>
            {clientOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select name="owner" defaultValue={filters.owner} className={SELECT}>
            <option value="">Any owner</option>
            {ownerOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select name="assignee" defaultValue={filters.assignee} className={SELECT}>
            <option value="">Any assignee</option>
            {assigneeOptions.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <button className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
            Apply
          </button>
        </form>
      </div>

      {filtered && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>
            Showing {visible.length} of {cards.length} jobs
          </span>
          <Link href="/admin/jobs" className="text-brand hover:text-brand-dark">
            Clear filters
          </Link>
        </div>
      )}

      <JobBoard cards={visible} today={today} />
    </div>
  );
}
```

- [ ] **Step 2: Verify the build and full suite**

Run: `npm run build`
Expected: `✓ Compiled successfully`.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 3: Verify in the browser**

Start the dev server with the preview tools (`preview_start` with the
`dashboard-v2` launch config — never `npm run dev` in Bash), open `/admin/jobs`, and confirm:
1. The board renders as before with no filters applied and no "Showing N of M" line.
2. Choosing a client and pressing Apply narrows the board and shows "Showing N of M" with a working "Clear filters" link.
3. "Just mine" highlights and narrows to jobs you own or are assigned.
4. Filters survive a page reload (they are in the URL).
5. `read_console_messages` reports no NEW errors.

Note: drag-and-drop cannot be exercised through browser automation in this
environment — do not claim you verified dragging. Confirm only what you observed.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/jobs/page.tsx"
git commit -m "feat(jobs): filter the board by client, owner, assignee or just mine

Server-rendered filters driven by searchParams, matching the /admin/activity
pattern. Options derive from the cards on the board.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: "My work" view

**Files:**
- Modify: `lib/views/jobs.ts` (append `getMyWork`)
- Create: `app/(admin)/admin/jobs/mine/page.tsx`

**Interfaces:**
- Consumes: `compareByDue`, `dueState`, `toDateString` from `lib/job-board-helpers.ts`.
- Produces:
  - `type MyJob = { id: string; title: string; clientName: string; status: JobStatus; dueDate: string | null; taskTotal: number; taskDone: number }`
  - `type MyTask = { id: string; label: string; jobId: string; jobTitle: string; clientName: string; dueDate: string | null }`
  - `type MyWork = { ownedJobs: MyJob[]; assignedTasks: MyTask[] }`
  - `getMyWork(profileId: string): Promise<MyWork>`

"Open" means a job whose status is neither `done` nor `cancelled`. Assigned tasks
are incomplete tasks on open jobs. A task's `dueDate` is its job's due date.

- [ ] **Step 1: Add getMyWork to the data layer**

Append to `lib/views/jobs.ts`:

```ts
export type MyJob = {
  id: string;
  title: string;
  clientName: string;
  status: JobStatus;
  dueDate: string | null;
  taskTotal: number;
  taskDone: number;
};
export type MyTask = {
  id: string;
  label: string;
  jobId: string;
  jobTitle: string;
  clientName: string;
  dueDate: string | null;
};
export type MyWork = { ownedJobs: MyJob[]; assignedTasks: MyTask[] };

/** One staffer's open work: jobs they own, and incomplete tasks assigned to them. */
export async function getMyWork(profileId: string): Promise<MyWork> {
  const supabase = await createClient();
  // One tasks query serves both purposes: the done/total counts need every task,
  // and the assigned list is the incomplete subset of the same rows.
  const [{ data: jobs }, { data: clients }, { data: tasks }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, client_id, title, owner_profile_id, status, due_date")
      .not("status", "in", "(done,cancelled)"),
    supabase.from("clients").select("id, name"),
    supabase.from("job_tasks").select("id, job_id, label, done, assignee_profile_id"),
  ]);
  const cn = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const openJobs = jobs ?? [];
  const byId = new Map(openJobs.map((j) => [j.id, j]));

  const counts = new Map<string, { t: number; d: number }>();
  for (const t of tasks ?? []) {
    const c = counts.get(t.job_id) ?? { t: 0, d: 0 };
    c.t++;
    if (t.done) c.d++;
    counts.set(t.job_id, c);
  }

  const ownedJobs: MyJob[] = openJobs
    .filter((j) => j.owner_profile_id === profileId)
    .map((j) => {
      const c = counts.get(j.id) ?? { t: 0, d: 0 };
      return {
        id: j.id,
        title: j.title,
        clientName: cn.get(j.client_id) ?? "—",
        status: j.status as JobStatus,
        dueDate: j.due_date,
        taskTotal: c.t,
        taskDone: c.d,
      };
    });

  const assignedTasks: MyTask[] = (tasks ?? [])
    .filter((t) => !t.done && t.assignee_profile_id === profileId && byId.has(t.job_id))
    .map((t) => {
      const j = byId.get(t.job_id)!;
      return {
        id: t.id,
        label: t.label,
        jobId: j.id,
        jobTitle: j.title,
        clientName: cn.get(j.client_id) ?? "—",
        dueDate: j.due_date,
      };
    });

  return { ownedJobs, assignedTasks };
}
```

- [ ] **Step 2: Create the page**

Create `app/(admin)/admin/jobs/mine/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getMyWork } from "@/lib/views/jobs";
import { getCurrentProfile } from "@/lib/auth/profile";
import { compareByDue, dueState, toDateString } from "@/lib/job-board-helpers";
import { PageHeader, Card, CardHeader } from "@/components/ui";

const STATUS_LABEL: Record<string, string> = {
  todo: "To do",
  in_progress: "In progress",
  waiting: "Waiting",
  done: "Done",
  cancelled: "Cancelled",
};

function DueTag({ dueDate, today }: { dueDate: string | null; today: string }) {
  const state = dueState(dueDate, today);
  if (state === "overdue") {
    return <span className="rounded bg-[#FEE2E2] px-1.5 py-0.5 text-[11px] font-semibold text-[#B91C1C]">Overdue</span>;
  }
  if (state === "due_soon") {
    return <span className="rounded bg-warn-tint px-1.5 py-0.5 text-[11px] text-warn-ink">Due soon</span>;
  }
  return null;
}

export default async function MyWorkPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const work = await getMyWork(me.profile.id);
  const today = toDateString(new Date());
  const ownedJobs = [...work.ownedJobs].sort(compareByDue);
  const assignedTasks = [...work.assignedTasks].sort(compareByDue);

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <Link href="/admin/jobs" className="hover:text-ink">
            ← Jobs
          </Link>
        }
        title="My work"
        subtitle="Everything open that you own or have been assigned."
      />

      <Card>
        <CardHeader title="Jobs you own" count={ownedJobs.length} />
        {ownedJobs.length === 0 ? (
          <div className="px-4 py-4 text-xs text-faint">Nothing open.</div>
        ) : (
          ownedJobs.map((j) => (
            <Link
              key={j.id}
              href={`/admin/jobs/${j.id}`}
              className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0 hover:bg-line-soft"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-semibold text-ink">{j.title}</div>
                <div className="truncate text-xs text-muted">{j.clientName}</div>
              </div>
              {j.taskTotal > 0 && (
                <span className="shrink-0 text-[11px] text-faint">
                  {j.taskDone}/{j.taskTotal} done
                </span>
              )}
              <DueTag dueDate={j.dueDate} today={today} />
              <span className="shrink-0 text-[11px] text-ink-3">{STATUS_LABEL[j.status] ?? j.status}</span>
            </Link>
          ))
        )}
      </Card>

      <Card>
        <CardHeader title="Tasks assigned to you" count={assignedTasks.length} />
        {assignedTasks.length === 0 ? (
          <div className="px-4 py-4 text-xs text-faint">Nothing assigned.</div>
        ) : (
          assignedTasks.map((t) => (
            <Link
              key={t.id}
              href={`/admin/jobs/${t.jobId}`}
              className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0 hover:bg-line-soft"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-ink">{t.label}</div>
                <div className="truncate text-xs text-muted">
                  {t.jobTitle} · {t.clientName}
                </div>
              </div>
              <DueTag dueDate={t.dueDate} today={today} />
            </Link>
          ))
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Verify the build and full suite**

Run: `npm run build`
Expected: `✓ Compiled successfully`, and `/admin/jobs/mine` appears in the route list.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 4: Verify in the browser**

Open `/admin/jobs/mine` and confirm both cards render, counts match what the
board shows for you, overdue items sort to the top, and each row links to its job.
Confirm the "My work →" pill on `/admin/jobs` reaches this page.

- [ ] **Step 5: Commit**

```bash
git add lib/views/jobs.ts "app/(admin)/admin/jobs/mine/page.tsx"
git commit -m "feat(jobs): my-work view of owned jobs and assigned tasks

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Pure digest content builder

**Files:**
- Create: `lib/job-digest.ts`
- Create: `lib/job-digest.test.ts`

**Interfaces:**
- Consumes: `compareByDue`, `dueState` from `lib/job-board-helpers.ts`.
- Produces:
  - `type DigestJob = { title: string; clientName: string; dueDate: string | null }`
  - `type DigestTask = { label: string; jobTitle: string; clientName: string; dueDate: string | null }`
  - `type DigestPerson = { email: string; name: string; ownedJobs: DigestJob[]; assignedTasks: DigestTask[] }`
  - `type Digest = { email: string; subject: string; body: string }`
  - `buildDigest(person: DigestPerson, today: string): Digest | null`
  - `buildDigests(people: DigestPerson[], today: string): Digest[]`

`buildDigest` returns `null` when the person has no open jobs and no assigned
tasks — that is how "staff with nothing open get no email" is enforced. `body` is
inner HTML; the caller wraps it.

- [ ] **Step 1: Write the failing tests**

Create `lib/job-digest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildDigest, buildDigests } from "./job-digest";

const TODAY = "2026-07-28";

const person = (over: Partial<Parameters<typeof buildDigest>[0]> = {}) => ({
  email: "tim@rocking.one",
  name: "Tim",
  ownedJobs: [{ title: "3CX migration", clientName: "Networkers Int", dueDate: null }],
  assignedTasks: [],
  ...over,
});

describe("buildDigest", () => {
  it("returns null when there is nothing open", () => {
    expect(buildDigest(person({ ownedJobs: [], assignedTasks: [] }), TODAY)).toBeNull();
  });
  it("greets by name and names the job", () => {
    const d = buildDigest(person(), TODAY)!;
    expect(d.email).toBe("tim@rocking.one");
    expect(d.body).toContain("Hi Tim,");
    expect(d.body).toContain("3CX migration");
    expect(d.body).toContain("Networkers Int");
  });
  it("summarises counts in the subject", () => {
    const d = buildDigest(
      person({
        ownedJobs: [{ title: "A", clientName: "C", dueDate: null }],
        assignedTasks: [{ label: "T", jobTitle: "A", clientName: "C", dueDate: null }],
      }),
      TODAY,
    )!;
    expect(d.subject).toContain("1 job");
    expect(d.subject).toContain("1 task");
  });
  it("uses singular and plural correctly", () => {
    const d = buildDigest(
      person({
        ownedJobs: [
          { title: "A", clientName: "C", dueDate: null },
          { title: "B", clientName: "C", dueDate: null },
        ],
        assignedTasks: [],
      }),
      TODAY,
    )!;
    expect(d.subject).toContain("2 jobs");
    expect(d.subject).not.toContain("task");
  });
  it("marks overdue items and lists them first", () => {
    const d = buildDigest(
      person({
        ownedJobs: [
          { title: "Later", clientName: "C", dueDate: "2026-08-30" },
          { title: "Late", clientName: "C", dueDate: "2026-07-01" },
          { title: "Undated", clientName: "C", dueDate: null },
        ],
      }),
      TODAY,
    )!;
    expect(d.body.indexOf("Late<")).toBeLessThan(d.body.indexOf("Later<"));
    expect(d.body.indexOf("Later<")).toBeLessThan(d.body.indexOf("Undated<"));
    expect(d.body).toContain("Overdue");
  });
  it("omits the tasks section entirely when there are none", () => {
    const d = buildDigest(person({ assignedTasks: [] }), TODAY)!;
    expect(d.body).not.toContain("Tasks assigned to you");
  });
  it("includes the tasks section when there are tasks", () => {
    const d = buildDigest(
      person({ assignedTasks: [{ label: "Clean laptops", jobTitle: "Laptop Assessment", clientName: "NI", dueDate: null }] }),
      TODAY,
    )!;
    expect(d.body).toContain("Tasks assigned to you");
    expect(d.body).toContain("Clean laptops");
  });
});

describe("buildDigests", () => {
  it("skips people with nothing open", () => {
    const out = buildDigests(
      [person(), person({ email: "idle@rocking.one", ownedJobs: [], assignedTasks: [] })],
      TODAY,
    );
    expect(out.map((d) => d.email)).toEqual(["tim@rocking.one"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/job-digest.test.ts`
Expected: FAIL — cannot resolve `./job-digest`.

- [ ] **Step 3: Implement the builder**

Create `lib/job-digest.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/job-digest.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Verify the full suite and build**

Run: `npx vitest run`
Expected: all pass.

Run: `npm run build`
Expected: `✓ Compiled successfully`.

- [ ] **Step 6: Commit**

```bash
git add lib/job-digest.ts lib/job-digest.test.ts
git commit -m "feat(jobs): pure weekly-digest content builder

Builds each staffer's open-work digest, overdue first, and returns null for
anyone with nothing open. Shared by the scheduled and manual sends.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Digest sender and secured trigger

**Files:**
- Modify: `lib/job-emails.ts` (append `sendJobDigest`)
- Create: `app/api/jobs/digest/route.ts`

**Interfaces:**
- Consumes: `buildDigests`, `DigestPerson` from Task 4; `getMyWork`-style data
  loaded directly here via the service client.
- Produces: `sendJobDigest(to: string, subject: string, html: string): Promise<void>`;
  `POST /api/jobs/digest`.

The route uses the SERVICE-ROLE client deliberately: a cron invocation has no
signed-in user, so RLS-scoped reads would return nothing. It is server-only and
guarded by a shared secret.

Auth: the request must carry `Authorization: Bearer <CRON_SECRET>`. This is the
header Vercel Cron sends automatically when `CRON_SECRET` is set in the project's
environment variables, so the same route works for both the manual trigger and a
future schedule.

**`CRON_SECRET` must be set in the Vercel project environment before this route
works in production.** If it is not set, the route refuses every request with 500
rather than running unauthenticated.

- [ ] **Step 1: Add the sender to the jobs email module**

Append to `lib/job-emails.ts` (it already has the private `sendEmail` and `wrap`
helpers this reuses — do not add a second Resend implementation):

```ts
/** Weekly open-work digest → one staff member. Body is inner HTML from lib/job-digest. */
export async function sendJobDigest(to: string, subject: string, html: string): Promise<void> {
  await sendEmail([to], subject, wrap(html));
}
```

- [ ] **Step 2: Create the route handler**

Create `app/api/jobs/digest/route.ts`:

```ts
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
 */
export async function POST(req: Request) {
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
  return NextResponse.json({ recipients: digests.length, sent });
}
```

- [ ] **Step 3: Verify the build and full suite**

Run: `npm run build`
Expected: `✓ Compiled successfully`, and `/api/jobs/digest` appears in the route list.

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 4: Verify the auth guard locally**

With the dev server running via the preview tools, check that the route rejects
unauthenticated calls. Run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/jobs/digest
```

Expected: `500` if `CRON_SECRET` is absent from `.env.local`, or `401` if it is
set (because no Authorization header was sent). Either proves the guard runs
before any data access. **Do not send a real digest** — the controller will do
the first live send deliberately.

- [ ] **Step 5: Commit**

```bash
git add lib/job-emails.ts app/api/jobs/digest/route.ts
git commit -m "feat(jobs): secured weekly open-work digest endpoint

POST /api/jobs/digest, guarded by CRON_SECRET, loads open work via the service
client and sends each staffer their digest. No schedule yet — the cron entry is
a deliberate follow-up once the wording has been reviewed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done criteria

- [ ] `npx vitest run` passes, including 11 new board-helper tests and 8 new digest tests.
- [ ] `npm run build` compiles cleanly.
- [ ] The board filters by client, owner, assignee and "just mine", with filters in the URL.
- [ ] `/admin/jobs/mine` lists owned jobs and assigned tasks, overdue first.
- [ ] `POST /api/jobs/digest` returns 401/500 without the correct bearer secret.
- [ ] No `vercel.json` and no cron entry were created.

## Out of scope

Golden ticket / pinning, staff comments, the activity trail (all Phase 3); the
cron schedule itself (deliberate follow-up); any change to drag-and-drop, due
dates, or the emails Phase 1 already sends.

## Follow-ups for the human

- `CRON_SECRET` must be added to the Vercel project environment before the
  digest can run in production.
