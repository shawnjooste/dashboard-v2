# Onboarding Email Sequence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paced series of short emails that walks each new portal user through the sections they can actually see, skips anything they already use, and fires later if a feature is switched on for them months afterwards.

**Architecture:** A catalogue of feature-triggered steps re-evaluated daily by a Vercel cron. All decision logic is one pure function (`dueSteps`) with no I/O, so every branch is provable in vitest. A composite primary key on `(profile_id, step_key)` makes duplicate sends impossible at the database level. Only *settled* outcomes get a row — a failed feature or data gate leaves no row, which is what lets a late feature grant fire.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres + RLS), Resend via `lib/email/send.ts`, vitest, Vercel cron.

**Spec:** `docs/superpowers/specs/2026-08-11-onboarding-sequence-design.md`

## Global Constraints

- **Supabase project ref is `eskhokedsximnslgsycs`.** Never `qomxwxxulxcwnpaqzudl` (a different, older project). Migrations run with `npx supabase db push --linked`.
- **Local dev reads `.env.local` and therefore talks to PRODUCTION Supabase.** Any live testing uses throwaway records that are deleted afterwards.
- **Never print or commit secrets.** Keys live in `.env.local` and are read at runtime.
- **Node is at `~/.local/bin/node`.** If `node` is not found, use that path.
- **Before `npx tsc --noEmit`, run `find .next -name "* 2.*" -delete`.** Stale duplicated build files cause spurious duplicate-identifier errors.
- **Migration numbers collide** when parallel sessions add files. Before creating `0086_*.sql`, run `ls supabase/migrations/ | tail -3` and use the next free number.
- **Vitest must never import `@/lib/supabase/server`.** Pure logic modules stay import-free of server code.
- **No backfill.** Nothing in this plan may enrol an existing profile implicitly. Only new invites, plus the explicit per-client script in Task 6.
- **Copy rule, applies to every step's wording:** each step must read correctly both as a day-7 tour email and as a "this is now available to you" note months later. No step may reference being new, being welcomed, or the order of other steps.

---

## File Structure

**Create:**
- `supabase/migrations/0086_onboarding_sequence.sql` — the two tables and their RLS
- `lib/onboarding/catalogue.ts` — the ordered step definitions (pure)
- `lib/onboarding/catalogue.test.ts` — catalogue integrity tests
- `lib/onboarding/step-content.ts` — email copy per step (pure)
- `lib/onboarding/sequence.ts` — `dueSteps`, the whole decision (pure)
- `lib/onboarding/sequence.test.ts` — the risk lives here
- `lib/onboarding/enrol.ts` — best-effort enrolment on invite (server-only)
- `app/api/jobs/onboarding-drip/route.ts` — the daily runner
- `scripts/onboarding-enrol.mjs` — explicit per-client enrolment
- `scripts/onboarding-dry-run.mjs` — readable preview of the next run

**Modify:**
- `lib/email/suppression.ts` — add `onboarding_step` to the suppressible set
- `lib/email/suppression.test.ts` — cover the new category
- `app/(admin)/admin/users/actions.ts:109` — enrol after the welcome email
- `app/(app)/team/actions.ts:74` — enrol after the welcome email
- `vercel.json` — add the cron entry
- `lib/types/database.ts` — regenerated after the migration

**Deliberate deviation from the spec:** the spec named `scripts/onboarding-drip.mjs --dry-run`. Implementing the decision logic twice (once in TS for the route, once in `.mjs` for a script) would be a correctness trap — the preview could disagree with the real run. Instead the route supports `?dry=1`, exactly like `app/api/jobs/time-nudge/route.ts` already does, and `scripts/onboarding-dry-run.mjs` is a thin client that calls it and pretty-prints. One implementation, same answer.

---

### Task 1: Database tables

**Files:**
- Create: `supabase/migrations/0086_onboarding_sequence.sql`
- Modify: `lib/types/database.ts` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: nothing.
- Produces: tables `onboarding_sequence_state` (`profile_id uuid pk`, `enrolled_at timestamptz`, `status text`) and `onboarding_sequence_sends` (`profile_id uuid`, `step_key text`, `decided_at timestamptz`, `outcome text`, primary key `(profile_id, step_key)`).

- [ ] **Step 1: Check the next free migration number**

Run: `ls supabase/migrations/ | tail -3`

If `0086_*` already exists, use the next free number and adjust the filename everywhere below.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0086_onboarding_sequence.sql`:

```sql
-- Onboarding email sequence.
--
-- Two tables, and the distinction between them is the whole design:
-- `state` says who is enrolled; `sends` records only steps that are SETTLED
-- and will never be reconsidered. A step whose feature or data gate fails is
-- NOT settled — it gets no row, so granting that feature months later makes
-- the step eligible again on the next run.

create table public.onboarding_sequence_state (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  -- No 'done': the sequence stays open so a late feature grant can still fire.
  status      text not null default 'active'
                check (status in ('active', 'stopped'))
);

create table public.onboarding_sequence_sends (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  step_key   text not null,
  decided_at timestamptz not null default now(),
  -- Settled outcomes only. A failed gate is "not eligible yet", not an outcome.
  outcome    text not null
               check (outcome in ('sent', 'skipped_already_using', 'suppressed')),
  primary key (profile_id, step_key)
);

-- The runner asks "what has this person already settled?" and
-- "when did they last actually receive one?".
create index onboarding_sends_profile_idx
  on public.onboarding_sequence_sends (profile_id, decided_at desc);

alter table public.onboarding_sequence_state enable row level security;
alter table public.onboarding_sequence_sends enable row level security;

-- Staff-read-only, matching portal_activity. All writes are service-role,
-- which bypasses RLS; no client user ever reads or writes these.
create policy "staff read onboarding state" on public.onboarding_sequence_state
  for select using (public.is_rocking_staff());
create policy "staff read onboarding sends" on public.onboarding_sequence_sends
  for select using (public.is_rocking_staff());
```

- [ ] **Step 3: Push the migration**

Run: `npx supabase db push --linked`
Expected: applies `0086_onboarding_sequence.sql` with no error.

- [ ] **Step 4: Verify the tables and the duplicate guard**

Run:

```bash
npx supabase db push --linked --dry-run
```

Expected: reports no pending migrations (confirming Step 3 landed).

- [ ] **Step 5: Regenerate the database types**

Run: `npx supabase gen types typescript --linked > lib/types/database.ts`

Then confirm both tables appear:

Run: `grep -c "onboarding_sequence_state\|onboarding_sequence_sends" lib/types/database.ts`
Expected: a number greater than 0.

- [ ] **Step 6: Typecheck**

Run: `find .next -name "* 2.*" -delete; npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0086_onboarding_sequence.sql lib/types/database.ts
git commit -m "feat(onboarding): add sequence state and sends tables"
```

---

### Task 2: The step catalogue

**Files:**
- Create: `lib/onboarding/catalogue.ts`
- Test: `lib/onboarding/catalogue.test.ts`

**Interfaces:**
- Consumes: `FEATURES` from `@/lib/feature-access`; `SECTION_LABELS` from `@/lib/activity-helpers`.
- Produces:
  - `type DataGate = "devices" | "xero" | null`
  - `type OnboardingStep = { key: string; minDays: number; feature: string | null; dataGate: DataGate; sections: string[]; subject: string }`
  - `const CATALOGUE: OnboardingStep[]` — ordered, five entries.

- [ ] **Step 1: Write the failing test**

Create `lib/onboarding/catalogue.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { CATALOGUE } from "./catalogue";
import { FEATURES } from "@/lib/feature-access";
import { SECTION_LABELS } from "@/lib/activity-helpers";

describe("CATALOGUE", () => {
  it("has unique step keys", () => {
    const keys = CATALOGUE.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names only real features", () => {
    for (const step of CATALOGUE) {
      if (step.feature) expect(FEATURES).toContain(step.feature);
    }
  });

  it("names only real activity sections", () => {
    for (const step of CATALOGUE) {
      expect(step.sections.length).toBeGreaterThan(0);
      for (const section of step.sections) {
        expect(Object.keys(SECTION_LABELS)).toContain(section);
      }
    }
  });

  it("is ordered by ascending minDays", () => {
    const days = CATALOGUE.map((s) => s.minDays);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  // /devices/<id> tracks as "device", the list as "devices". A step that
  // watched only one of them would miss someone who uses the other.
  it("treats both device sections as usage", () => {
    const devices = CATALOGUE.find((s) => s.key === "devices");
    expect(devices?.sections).toEqual(expect.arrayContaining(["devices", "device"]));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/onboarding/catalogue.test.ts`
Expected: FAIL — cannot resolve `./catalogue`.

- [ ] **Step 3: Write the catalogue**

Create `lib/onboarding/catalogue.ts`:

```ts
/** The onboarding tour, as data. Pure — no server imports (vitest-safe).
 *
 *  Order is the order steps are offered. `minDays` is the EARLIEST a step may
 *  fire, measured from enrolment, not a schedule: a feature granted long after
 *  onboarding has its floor already in the past and fires on the next run.
 *  Every step's copy must therefore read correctly both ways. */

export type DataGate = "devices" | "xero" | null;

export type OnboardingStep = {
  /** Stable identifier stored in onboarding_sequence_sends.step_key.
   *  Never rename one — a rename re-sends the step to everybody. */
  key: string;
  /** Earliest day, counted from enrolment. */
  minDays: number;
  /** Feature that must be visible to the recipient; null means everyone. */
  feature: string | null;
  /** Client data that must exist before the step is worth sending. */
  dataGate: DataGate;
  /** portal_activity sections that count as "already using this". */
  sections: string[];
  subject: string;
};

export const CATALOGUE: OnboardingStep[] = [
  {
    key: "support",
    minDays: 3,
    feature: null, // Support is not gated — everyone can raise a request.
    dataGate: null,
    sections: ["support"],
    subject: "Getting help, without the phone tag",
  },
  {
    key: "devices",
    minDays: 7,
    feature: "devices",
    dataGate: "devices",
    // The list tracks as "devices"; a single machine tracks as "device".
    sections: ["devices", "device"],
    subject: "Your computers, and how safe they are",
  },
  {
    key: "billing",
    minDays: 11,
    feature: "billing",
    dataGate: "xero",
    sections: ["billing"],
    subject: "Your invoices and balance, whenever you want them",
  },
  {
    key: "connectivity",
    minDays: 15,
    feature: "connectivity",
    dataGate: null, // The empty state sells connectivity, so no data needed.
    sections: ["connectivity"],
    subject: "Seeing your connection, live",
  },
  {
    key: "team",
    minDays: 19,
    feature: "team",
    dataGate: null,
    sections: ["team"],
    subject: "Adding your colleagues to the portal",
  },
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/onboarding/catalogue.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding/catalogue.ts lib/onboarding/catalogue.test.ts
git commit -m "feat(onboarding): add the step catalogue"
```

---

### Task 3: The decision function

This is where all the risk lives. Everything else is plumbing.

**Files:**
- Create: `lib/onboarding/sequence.ts`
- Test: `lib/onboarding/sequence.test.ts`

**Interfaces:**
- Consumes: `canAccess`, `type Overrides` from `@/lib/feature-access`; `CATALOGUE` from `@/lib/onboarding/catalogue`.
- Produces:
  - `const MIN_DAYS_BETWEEN_SENDS = 4`
  - `type StepDecision = { stepKey: string; outcome: "sent" | "skipped_already_using" }`
  - `type SequenceInput = { now, enrolledAt, role, overrides, settled, lastSentAt, visitedSections, hasDevices, hasXero }`
  - `function dueSteps(input: SequenceInput): StepDecision[]` — any number of skips, at most one `sent`, always last.

- [ ] **Step 1: Write the failing test**

Create `lib/onboarding/sequence.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dueSteps, MIN_DAYS_BETWEEN_SENDS, type SequenceInput } from "./sequence";

const DAY = 86_400_000;
const NOW = new Date("2026-08-11T07:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

/** A manager, 30 days in, using nothing, with every data gate satisfied. */
function input(over: Partial<SequenceInput> = {}): SequenceInput {
  return {
    now: NOW,
    enrolledAt: daysAgo(30),
    role: "client_manager",
    overrides: null,
    settled: new Set<string>(),
    lastSentAt: null,
    visitedSections: new Set<string>(),
    hasDevices: true,
    hasXero: true,
    ...over,
  };
}

describe("dueSteps", () => {
  it("sends nothing before the first floor", () => {
    expect(dueSteps(input({ enrolledAt: daysAgo(1) }))).toEqual([]);
  });

  it("offers the first due step", () => {
    expect(dueSteps(input({ enrolledAt: daysAgo(3) }))).toEqual([
      { stepKey: "support", outcome: "sent" },
    ]);
  });

  it("never returns more than one send", () => {
    const sends = dueSteps(input()).filter((d) => d.outcome === "sent");
    expect(sends).toHaveLength(1);
  });

  it("puts the send last", () => {
    const decisions = dueSteps(input({ visitedSections: new Set(["support"]) }));
    expect(decisions[decisions.length - 1].outcome).toBe("sent");
  });

  it("settles a step the person already uses", () => {
    expect(dueSteps(input({ visitedSections: new Set(["support"]) }))).toEqual([
      { stepKey: "support", outcome: "skipped_already_using" },
      { stepKey: "devices", outcome: "sent" },
    ]);
  });

  it("counts a single device page as using devices", () => {
    const decisions = dueSteps(
      input({ visitedSections: new Set(["support", "device"]) }),
    );
    expect(decisions).toContainEqual({
      stepKey: "devices",
      outcome: "skipped_already_using",
    });
  });

  it("settles every skip in one pass, not one per run", () => {
    const decisions = dueSteps(
      input({ visitedSections: new Set(["support", "devices", "billing"]) }),
    );
    expect(decisions.filter((d) => d.outcome === "skipped_already_using")).toHaveLength(3);
    expect(decisions[3]).toEqual({ stepKey: "connectivity", outcome: "sent" });
  });

  it("leaves NO decision for a failed feature gate, so it stays eligible", () => {
    // Devices switched off: the step is passed over silently, no row written,
    // so it fires later if devices is switched back on.
    const decisions = dueSteps(
      input({
        overrides: { devices: false },
        visitedSections: new Set(["support"]),
      }),
    );
    expect(decisions.map((d) => d.stepKey)).not.toContain("devices");
    expect(decisions).toEqual([
      { stepKey: "support", outcome: "skipped_already_using" },
      { stepKey: "billing", outcome: "sent" },
    ]);
  });

  it("leaves NO decision for a failed data gate, so it stays eligible", () => {
    const decisions = dueSteps(
      input({ hasDevices: false, visitedSections: new Set(["support"]) }),
    );
    expect(decisions.map((d) => d.stepKey)).not.toContain("devices");
  });

  it("fires a step whose feature is granted long after enrolment", () => {
    // A year in, every other step settled, connectivity just switched on.
    const decisions = dueSteps(
      input({
        enrolledAt: daysAgo(365),
        settled: new Set(["support", "devices", "billing", "team"]),
      }),
    );
    expect(decisions).toEqual([{ stepKey: "connectivity", outcome: "sent" }]);
  });

  it("never reconsiders a settled step", () => {
    const decisions = dueSteps(input({ settled: new Set(["support"]) }));
    expect(decisions.map((d) => d.stepKey)).not.toContain("support");
  });

  it("holds the send until the gap has passed", () => {
    expect(dueSteps(input({ lastSentAt: daysAgo(1) }))).toEqual([]);
  });

  it("sends once the gap has passed", () => {
    expect(
      dueSteps(input({ lastSentAt: daysAgo(MIN_DAYS_BETWEEN_SENDS) })),
    ).toEqual([{ stepKey: "support", outcome: "sent" }]);
  });

  it("still settles skips while the gap holds the send back", () => {
    const decisions = dueSteps(
      input({ lastSentAt: daysAgo(1), visitedSections: new Set(["support"]) }),
    );
    expect(decisions).toEqual([
      { stepKey: "support", outcome: "skipped_already_using" },
    ]);
  });

  it("does not let a later step jump the queue while the gap holds", () => {
    // support is sendable but gap-blocked; devices must NOT go instead.
    const decisions = dueSteps(input({ lastSentAt: daysAgo(1) }));
    expect(decisions.map((d) => d.stepKey)).not.toContain("devices");
  });

  it("gives a member only the support step", () => {
    const decisions = dueSteps(input({ role: "client_member" }));
    expect(decisions).toEqual([{ stepKey: "support", outcome: "sent" }]);
  });

  it("returns nothing when every step is settled", () => {
    expect(
      dueSteps(
        input({
          settled: new Set(["support", "devices", "billing", "connectivity", "team"]),
        }),
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/onboarding/sequence.test.ts`
Expected: FAIL — cannot resolve `./sequence`.

- [ ] **Step 3: Write the implementation**

Create `lib/onboarding/sequence.ts`:

```ts
/** The whole onboarding decision, as one pure function. No I/O, no clock of
 *  its own, no Supabase import — so every branch is provable in vitest. */
import { canAccess, type Overrides } from "@/lib/feature-access";
import { CATALOGUE } from "@/lib/onboarding/catalogue";

/** Days a person must go without a step email before the next one. */
export const MIN_DAYS_BETWEEN_SENDS = 4;

/** `suppressed` is decided by the caller, which knows the opt-out state. */
export type StepDecision = {
  stepKey: string;
  outcome: "sent" | "skipped_already_using";
};

export type SequenceInput = {
  now: Date;
  enrolledAt: Date;
  role: string;
  overrides: Overrides;
  /** step_keys already in onboarding_sequence_sends for this person. */
  settled: Set<string>;
  /** decided_at of their most recent 'sent' row, or null. */
  lastSentAt: Date | null;
  /** Distinct portal_activity sections this person has visited. */
  visitedSections: Set<string>;
  hasDevices: boolean;
  hasXero: boolean;
};

const daysBetween = (from: Date, to: Date) =>
  (to.getTime() - from.getTime()) / 86_400_000;

/** Any number of `skipped_already_using` decisions, and at most one `sent`,
 *  which is always last. Empty when nothing is due.
 *
 *  A step failing its feature or data gate is deliberately NOT returned: it is
 *  "not eligible yet", not a decision, so no row is written and it becomes
 *  eligible again the moment the gate opens. That is what makes a feature
 *  granted months later still fire. */
export function dueSteps(input: SequenceInput): StepDecision[] {
  const decisions: StepDecision[] = [];
  const age = daysBetween(input.enrolledAt, input.now);
  const gapOk =
    input.lastSentAt === null ||
    daysBetween(input.lastSentAt, input.now) >= MIN_DAYS_BETWEEN_SENDS;

  for (const step of CATALOGUE) {
    if (input.settled.has(step.key)) continue;
    if (age < step.minDays) continue;
    if (step.feature && !canAccess(input.role, input.overrides, step.feature)) continue;
    if (step.dataGate === "devices" && !input.hasDevices) continue;
    if (step.dataGate === "xero" && !input.hasXero) continue;

    // Already using it: settle for free and keep walking — skips cost nothing
    // and an established enrolee should settle them all in one pass.
    if (step.sections.some((s) => input.visitedSections.has(s))) {
      decisions.push({ stepKey: step.key, outcome: "skipped_already_using" });
      continue;
    }

    // The first step that would actually send ends the walk either way. If the
    // pacing gap has not passed we send nothing rather than letting a later
    // step jump the queue.
    if (gapOk) decisions.push({ stepKey: step.key, outcome: "sent" });
    return decisions;
  }
  return decisions;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/onboarding/sequence.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Typecheck**

Run: `find .next -name "* 2.*" -delete; npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/onboarding/sequence.ts lib/onboarding/sequence.test.ts
git commit -m "feat(onboarding): add dueSteps decision function"
```

---

### Task 4: Step email copy

**Files:**
- Create: `lib/onboarding/step-content.ts`
- Test: `lib/onboarding/step-content.test.ts`

**Interfaces:**
- Consumes: `onboardingEmailHtml`, `type OnboardingFeature` from `@/lib/onboarding-email`; `CATALOGUE` from `@/lib/onboarding/catalogue`.
- Produces: `function stepEmailHtml(stepKey: string, opts: { firstName: string; companyName: string; portalUrl: string }): string | null` — null for an unknown key.

Copy must obey the Global Constraints copy rule: no step may reference being new or welcomed.

- [ ] **Step 1: Write the failing test**

Create `lib/onboarding/step-content.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { stepEmailHtml } from "./step-content";
import { CATALOGUE } from "./catalogue";

const opts = {
  firstName: "Sam",
  companyName: "GSR",
  portalUrl: "https://portal.rocking.one/support",
};

describe("stepEmailHtml", () => {
  it("renders every catalogue step", () => {
    for (const step of CATALOGUE) {
      const html = stepEmailHtml(step.key, opts);
      expect(html, `missing copy for ${step.key}`).toBeTruthy();
      expect(html).toContain("Sam");
    }
  });

  it("returns null for an unknown step", () => {
    expect(stepEmailHtml("nope", opts)).toBeNull();
  });

  it("escapes the company name", () => {
    const html = stepEmailHtml("support", { ...opts, companyName: "A & B <script>" });
    expect(html).not.toContain("<script>");
  });

  // These land months later for someone granted a feature late, so they must
  // not pretend the reader has just arrived.
  it("never talks about being new", () => {
    for (const step of CATALOGUE) {
      const html = (stepEmailHtml(step.key, opts) ?? "").toLowerCase();
      for (const phrase of ["welcome", "getting started", "just joined", "new here"]) {
        expect(html, `${step.key} says "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/onboarding/step-content.test.ts`
Expected: FAIL — cannot resolve `./step-content`.

- [ ] **Step 3: Write the copy**

Create `lib/onboarding/step-content.ts`:

```ts
/** Copy for each catalogue step.
 *
 *  Every one of these can arrive on day 7 of a tour OR months later, the first
 *  time a feature is switched on for someone. So none of them may mention
 *  being new, being welcomed, or where they sit in the sequence — they simply
 *  explain one part of the portal. */
import { onboardingEmailHtml, type OnboardingFeature } from "@/lib/onboarding-email";

type Copy = {
  headline: string;
  preheader: string;
  intro: (company: string) => string;
  eyebrow: string;
  ctaLabel: string;
  features: OnboardingFeature[];
};

// onboardingEmailHtml escapes firstName, companyName, headline, eyebrow,
// ctaLabel, preheader and feature text. `intro` is inserted as HTML, so the
// company name is escaped here before it goes in.
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const COPY: Record<string, Copy> = {
  support: {
    headline: "Getting help, without the phone tag",
    preheader: "How to raise a request and follow it through.",
    intro: (company) =>
      `Anything ${esc(company)} needs from us can start right here &mdash; described in plain English, tracked in one place, and answered by a real person.`,
    eyebrow: "How it works",
    ctaLabel: "Raise a request",
    features: [
      { title: "Say what you need, plainly", body: "No forms full of jargon and no ticket numbers to remember — just tell us what's wrong." },
      { title: "Watch it move", body: "See what we're doing about it and reply in the same place, without digging through your inbox." },
      { title: "Keep the history", body: "Every request and how it was resolved stays together, so nothing has to be re-explained." },
    ],
  },
  devices: {
    headline: "Your computers, and how safe they are",
    preheader: "What we can see about the machines we look after.",
    intro: (company) =>
      `Every machine we look after for ${esc(company)} reports in &mdash; so you can see what you own, who uses it, and whether it&rsquo;s protected, without asking anyone.`,
    eyebrow: "What you'll find",
    ctaLabel: "Open Devices",
    features: [
      { title: "Every machine, listed", body: "What each one is, who last used it, and when we last heard from it." },
      { title: "Whether it's protected", body: "Antivirus and updates, at a glance — so a machine falling behind is obvious rather than invisible." },
      { title: "Photos and condition", body: "We add a photo and the condition of each machine as we handle it, which makes an audit or an insurance claim much less painful." },
    ],
  },
  billing: {
    headline: "Your invoices and balance, whenever you want them",
    preheader: "Every invoice and what's outstanding, in one place.",
    intro: (company) =>
      `The billing page shows what ${esc(company)} owes and every invoice behind it &mdash; no waiting on an email and no need to ask.`,
    eyebrow: "What's on the page",
    ctaLabel: "Open Billing",
    features: [
      { title: "What's outstanding", body: "Your balance and anything overdue, right at the top." },
      { title: "Every invoice", body: "Paid and unpaid, going back — open any one of them without hunting through email." },
      { title: "Always current", body: "It reads straight from our accounts, so it matches what we see." },
    ],
  },
  connectivity: {
    headline: "Seeing your connection, live",
    preheader: "Whether your line is up, and where a fault actually sits.",
    intro: (company) =>
      `The connectivity page tells you whether the line at ${esc(company)} is healthy right now &mdash; and, when something is wrong, where the problem actually is rather than who to blame.`,
    eyebrow: "What it shows",
    ctaLabel: "Open Connectivity",
    features: [
      { title: "Up or down, right now", body: "Live status and response time, with the last 24 hours drawn out so you can tell a blip from a pattern." },
      { title: "Where the fault sits", body: "Your connection is drawn hop by hop, so a problem shows up in one place instead of being a guess." },
      { title: "Not with us yet?", body: "If we don't provide your line, the page will ask for your address and we'll come back with what's available there." },
    ],
  },
  team: {
    headline: "Adding your colleagues to the portal",
    preheader: "Invite the people who should see this too.",
    intro: (company) =>
      `You can invite anyone at ${esc(company)} to the portal yourself, and decide how much they see.`,
    eyebrow: "What you can do",
    ctaLabel: "Open Team",
    features: [
      { title: "Invite in seconds", body: "Add a colleague's email and they get their own sign-in — no request to us needed." },
      { title: "Choose what they see", body: "Managers get the full picture; members get support and their own machine, and nothing else." },
      { title: "Remove people just as easily", body: "When someone leaves, take their access away from the same page." },
    ],
  },
};

/** Rendered HTML for a step, or null when the key is unknown. */
export function stepEmailHtml(
  stepKey: string,
  opts: { firstName: string; companyName: string; portalUrl: string },
): string | null {
  const copy = COPY[stepKey];
  if (!copy) return null;
  return onboardingEmailHtml({
    firstName: opts.firstName,
    companyName: opts.companyName,
    portalUrl: opts.portalUrl,
    headline: copy.headline,
    preheader: copy.preheader,
    intro: copy.intro(opts.companyName),
    eyebrow: copy.eyebrow,
    ctaLabel: copy.ctaLabel,
    features: copy.features,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/onboarding/step-content.test.ts`
Expected: PASS, 4 tests.

If the "never talks about being new" test fails, the offending phrase is in `onboardingEmailHtml`'s default `headline` or `preheader` — pass explicit values for both (the copy above already does) rather than weakening the test.

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding/step-content.ts lib/onboarding/step-content.test.ts
git commit -m "feat(onboarding): add step email copy"
```

---

### Task 5: Suppression category and enrolment on invite

**Files:**
- Modify: `lib/email/suppression.ts`
- Modify: `lib/email/suppression.test.ts`
- Create: `lib/onboarding/enrol.ts`
- Modify: `app/(admin)/admin/users/actions.ts` (after the `sendOnboardingEmail` call at :109)
- Modify: `app/(app)/team/actions.ts` (after the `sendOnboardingEmail` call at :74)

**Interfaces:**
- Consumes: `createServiceClient` from `@/lib/supabase/service`.
- Produces: `async function enrolInOnboarding(profileId: string): Promise<void>` — best-effort, never throws.

- [ ] **Step 1: Write the failing suppression test**

Add to `lib/email/suppression.test.ts`:

```ts
it("suppresses onboarding step emails", () => {
  expect(isSuppressible("onboarding_step")).toBe(true);
});

// The welcome email carries the sign-in link. It must always send.
it("never suppresses the welcome email", () => {
  expect(isSuppressible("onboarding")).toBe(false);
});
```

- [ ] **Step 2: Run it to verify the first fails**

Run: `npx vitest run lib/email/suppression.test.ts`
Expected: FAIL on "suppresses onboarding step emails" (received `false`). The welcome test passes already.

- [ ] **Step 3: Add the category**

In `lib/email/suppression.ts`, change the set to:

```ts
/** Categories a Portal Updates opt-out may silence. Deliberately an
 *  allow-list: transactional mail (invites, quotes, bookings, support) must
 *  always send, so anything not named here is unsuppressible by construction.
 *  `onboarding_step` is the tour; `onboarding` — the welcome, which carries
 *  the sign-in link — is deliberately absent. */
export const SUPPRESSIBLE_CATEGORIES: ReadonlySet<string> = new Set([
  "portal_update",
  "onboarding_step",
]);
```

- [ ] **Step 4: Run the suppression tests**

Run: `npx vitest run lib/email/suppression.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the enrolment helper**

Create `lib/onboarding/enrol.ts`:

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

/** Enrol a profile in the onboarding sequence. Best-effort by design: an
 *  invite must never fail because the drip could not be started, so this
 *  swallows and logs. Idempotent — re-enrolling an existing row is ignored,
 *  which keeps `enrolled_at` (and therefore every day floor) stable. */
export async function enrolInOnboarding(profileId: string): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .from("onboarding_sequence_state")
      .upsert({ profile_id: profileId }, { onConflict: "profile_id", ignoreDuplicates: true });
    if (error) console.error("enrolInOnboarding failed:", error.message);
  } catch (e) {
    console.error("enrolInOnboarding failed:", e);
  }
}
```

- [ ] **Step 6: Wire into the admin invite path**

Read `app/(admin)/admin/users/actions.ts` around line 109. Immediately after the `await sendOnboardingEmail({...})` call completes, add:

```ts
    // Start the tour. Best-effort — never let this fail an invite.
    await enrolInOnboarding(profileId);
```

Replace `profileId` with whatever the surrounding code calls the newly created profile's id. If the id is not in scope at that point, select it back:

```ts
    const { data: created } = await service
      .from("profiles").select("id").eq("email", email).maybeSingle();
    if (created) await enrolInOnboarding(created.id);
```

Add the import at the top:

```ts
import { enrolInOnboarding } from "@/lib/onboarding/enrol";
```

- [ ] **Step 7: Wire into the client team invite path**

Do the same in `app/(app)/team/actions.ts` after the `sendOnboardingEmail` call at line 74, with the same import.

- [ ] **Step 8: Typecheck**

Run: `find .next -name "* 2.*" -delete; npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Run the full suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add lib/email/suppression.ts lib/email/suppression.test.ts lib/onboarding/enrol.ts \
  "app/(admin)/admin/users/actions.ts" "app/(app)/team/actions.ts"
git commit -m "feat(onboarding): enrol on invite, make step emails suppressible"
```

---

### Task 6: The daily runner

**Files:**
- Create: `app/api/jobs/onboarding-drip/route.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `dueSteps` from `@/lib/onboarding/sequence`; `CATALOGUE` from `@/lib/onboarding/catalogue`; `stepEmailHtml` from `@/lib/onboarding/step-content`; `sendEmail` from `@/lib/email/send`; `toOverrides` from `@/lib/feature-access`; `createServiceClient` from `@/lib/supabase/service`. (The pacing gap lives entirely inside `dueSteps` — the runner never reasons about it.)
- Produces: `GET`/`POST` handlers at `/api/jobs/onboarding-drip`, supporting `?dry=1`.

- [ ] **Step 1: Write the route**

Create `app/api/jobs/onboarding-drip/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { toOverrides } from "@/lib/feature-access";
import { CATALOGUE } from "@/lib/onboarding/catalogue";
import { dueSteps } from "@/lib/onboarding/sequence";
import { stepEmailHtml } from "@/lib/onboarding/step-content";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

/** A bug here emails hundreds of real customers, so a run can never exceed
 *  this many sends. Hitting it is logged loudly rather than silently truncated. */
const MAX_SENDS_PER_RUN = 200;

/** Page through a table — PostgREST silently caps unbounded selects at ~1000
 *  rows, which would look like "these people have never visited anything". */
async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * Daily onboarding drip.
 *
 * Walks everyone enrolled, asks the pure `dueSteps` what each is owed, and
 * settles it. Only settled outcomes are written: a step failing its feature or
 * data gate gets no row, so it fires later if that feature is switched on.
 *
 * Service-role (a scheduled run has no signed-in user), guarded by the same
 * CRON_SECRET bearer as the other jobs, exported as GET and POST so the
 * scheduled and manual paths cannot diverge.
 *
 * `?dry=1` reports exactly what would happen and writes nothing.
 */
async function runDrip(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET not set — refusing to run the onboarding drip");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const service = createServiceClient();
  const now = new Date();

  const state = await fetchAll<{ profile_id: string; enrolled_at: string }>((f, t) =>
    service
      .from("onboarding_sequence_state")
      .select("profile_id, enrolled_at")
      .eq("status", "active")
      .order("profile_id")
      .range(f, t),
  );
  if (state.length === 0) return NextResponse.json({ enrolled: 0, sent: 0, settled: 0 });

  const ids = state.map((s) => s.profile_id);

  const [profiles, sends, activity, clients, devices] = await Promise.all([
    fetchAll<{
      id: string; email: string; role: string; status: string; client_id: string | null;
      feature_overrides: unknown; portal_updates_opt_out: boolean;
      people: { display_name: string | null } | { display_name: string | null }[] | null;
    }>((f, t) =>
      service
        .from("profiles")
        .select("id, email, role, status, client_id, feature_overrides, portal_updates_opt_out, people(display_name)")
        .in("id", ids)
        .order("id")
        .range(f, t),
    ),
    fetchAll<{ profile_id: string; step_key: string; outcome: string; decided_at: string }>((f, t) =>
      service
        .from("onboarding_sequence_sends")
        .select("profile_id, step_key, outcome, decided_at")
        .in("profile_id", ids)
        .order("profile_id")
        .range(f, t),
    ),
    fetchAll<{ profile_id: string | null; section: string }>((f, t) =>
      service
        .from("portal_activity")
        .select("profile_id, section")
        .in("profile_id", ids)
        .in("section", [...new Set(CATALOGUE.flatMap((s) => s.sections))])
        .order("profile_id")
        .range(f, t),
    ),
    fetchAll<{ id: string; name: string; xero_contact_id: string | null }>((f, t) =>
      service.from("clients").select("id, name, xero_contact_id").order("id").range(f, t),
    ),
    fetchAll<{ client_id: string }>((f, t) =>
      service.from("devices").select("client_id").order("client_id").range(f, t),
    ),
  ]);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const clientsWithDevices = new Set(devices.map((d) => d.client_id));

  const settledBy = new Map<string, Set<string>>();
  const lastSentBy = new Map<string, Date>();
  for (const s of sends) {
    if (!settledBy.has(s.profile_id)) settledBy.set(s.profile_id, new Set());
    settledBy.get(s.profile_id)!.add(s.step_key);
    if (s.outcome === "sent") {
      const at = new Date(s.decided_at);
      const prev = lastSentBy.get(s.profile_id);
      if (!prev || at > prev) lastSentBy.set(s.profile_id, at);
    }
  }

  const visitedBy = new Map<string, Set<string>>();
  for (const a of activity) {
    if (!a.profile_id) continue;
    if (!visitedBy.has(a.profile_id)) visitedBy.set(a.profile_id, new Set());
    visitedBy.get(a.profile_id)!.add(a.section);
  }

  const rows: { profile_id: string; step_key: string; outcome: string }[] = [];
  const preview: { email: string; step: string; outcome: string }[] = [];
  const stopped: string[] = [];
  let sent = 0;
  let capped = false;

  for (const s of state) {
    const p = profileById.get(s.profile_id);
    // Deactivated or deleted since enrolment — stop, don't email.
    if (!p || p.status !== "active") {
      stopped.push(s.profile_id);
      continue;
    }
    const client = p.client_id ? clientById.get(p.client_id) : null;
    const decisions = dueSteps({
      now,
      enrolledAt: new Date(s.enrolled_at),
      role: p.role,
      overrides: toOverrides(p.feature_overrides ?? null),
      settled: settledBy.get(p.id) ?? new Set(),
      lastSentAt: lastSentBy.get(p.id) ?? null,
      visitedSections: visitedBy.get(p.id) ?? new Set(),
      hasDevices: !!p.client_id && clientsWithDevices.has(p.client_id),
      hasXero: !!client?.xero_contact_id,
    });

    for (const d of decisions) {
      if (d.outcome === "skipped_already_using") {
        rows.push({ profile_id: p.id, step_key: d.stepKey, outcome: d.outcome });
        preview.push({ email: p.email, step: d.stepKey, outcome: d.outcome });
        continue;
      }
      // outcome === "sent"
      if (p.portal_updates_opt_out) {
        // Record it so their sequence advances instead of stalling here
        // forever. sendEmail would suppress it anyway; not calling is cleaner.
        rows.push({ profile_id: p.id, step_key: d.stepKey, outcome: "suppressed" });
        preview.push({ email: p.email, step: d.stepKey, outcome: "suppressed" });
        continue;
      }
      if (sent >= MAX_SENDS_PER_RUN) {
        capped = true;
        continue;
      }
      preview.push({ email: p.email, step: d.stepKey, outcome: "sent" });
      if (dry) {
        sent++;
        continue;
      }
      const step = CATALOGUE.find((c) => c.key === d.stepKey)!;
      const person = Array.isArray(p.people) ? p.people[0] : p.people;
      const firstName = (person?.display_name ?? p.email).split(" ")[0];
      const html = stepEmailHtml(d.stepKey, {
        firstName,
        companyName: client?.name ?? "your company",
        portalUrl: `${APP_URL}/${d.stepKey}`,
      });
      if (!html) {
        console.error("onboarding drip: no copy for step", d.stepKey);
        continue;
      }
      try {
        await sendEmail({
          to: [p.email],
          subject: step.subject,
          html,
          category: "onboarding_step",
          audience: "client",
          clientId: p.client_id,
        });
        rows.push({ profile_id: p.id, step_key: d.stepKey, outcome: "sent" });
        sent++;
      } catch (e) {
        // No row: an unsent step must stay eligible for tomorrow's run.
        console.error("onboarding drip: send failed for", p.email, d.stepKey, e);
      }
    }
  }

  if (capped) {
    console.error(`onboarding drip: hit the ${MAX_SENDS_PER_RUN}-send cap — some steps deferred`);
  }

  if (dry) {
    return NextResponse.json({
      dryRun: true,
      enrolled: state.length,
      wouldSend: preview.filter((p) => p.outcome === "sent").length,
      wouldSettle: preview.filter((p) => p.outcome !== "sent").length,
      wouldStop: stopped.length,
      capped,
      decisions: preview.slice(0, 100),
    });
  }

  if (rows.length) {
    const { error } = await service.from("onboarding_sequence_sends").insert(rows);
    if (error) console.error("onboarding drip: recording decisions failed", error.message);
  }
  if (stopped.length) {
    await service
      .from("onboarding_sequence_state")
      .update({ status: "stopped" })
      .in("profile_id", stopped);
  }

  return NextResponse.json({
    enrolled: state.length,
    sent,
    settled: rows.length - sent,
    stopped: stopped.length,
    capped,
  });
}

export const GET = runDrip;
export const POST = runDrip;
```

Note the ordering hazard this code deliberately avoids: `sent` rows are inserted **after** the sends, so a send that throws leaves no row and stays eligible tomorrow — an unsent step must never look settled.

- [ ] **Step 2: Typecheck**

Run: `find .next -name "* 2.*" -delete; npx tsc --noEmit`
Expected: no errors.

If `service.from("onboarding_sequence_sends")` is not typed, `lib/types/database.ts` was not regenerated in Task 1 — re-run `npx supabase gen types typescript --linked > lib/types/database.ts`.

- [ ] **Step 3: Add the cron**

In `vercel.json`, add to the `crons` array (09:00 SAST = 07:00 UTC):

```json
    {
      "path": "/api/jobs/onboarding-drip",
      "schedule": "0 7 * * *"
    }
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds, with `/api/jobs/onboarding-drip` in the route list.

- [ ] **Step 5: Commit**

```bash
git add "app/api/jobs/onboarding-drip/route.ts" vercel.json
git commit -m "feat(onboarding): add daily drip runner"
```

---

### Task 7: Enrolment and dry-run scripts

**Files:**
- Create: `scripts/onboarding-enrol.mjs`
- Create: `scripts/onboarding-dry-run.mjs`

**Interfaces:**
- Consumes: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `CRON_SECRET` from `.env.local`; the `/api/jobs/onboarding-drip?dry=1` endpoint.
- Produces: two CLI entry points. Neither is imported by application code.

Check the exact env var names another script uses (`head -20 scripts/security-normalize.mjs`) and match them rather than assuming.

- [ ] **Step 1: Write the enrolment script**

Create `scripts/onboarding-enrol.mjs`:

```js
#!/usr/bin/env node
/**
 * Enrol one client's people in the onboarding sequence.
 *
 *   node scripts/onboarding-enrol.mjs --client "GSR" [--dry-run]
 *
 * There is no bulk mode and no "all clients" flag on purpose: enrolling is a
 * decision to email real customers, taken one client at a time. Re-running is
 * safe — people already enrolled are reported and left alone, so their
 * enrolled_at (and every day floor derived from it) never moves.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const name = args[args.indexOf("--client") + 1];
if (!args.includes("--client") || !name) {
  console.error('Usage: node scripts/onboarding-enrol.mjs --client "Name" [--dry-run]');
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: clients } = await db.from("clients").select("id, name").ilike("name", `%${name}%`);
if (!clients?.length) {
  console.error(`No client matching "${name}".`);
  process.exit(1);
}
if (clients.length > 1) {
  // Never guess which customer to email.
  console.error(`"${name}" matches ${clients.length} clients — be more specific:`);
  for (const c of clients) console.error(`  ${c.name}`);
  process.exit(1);
}
const client = clients[0];

const { data: profiles } = await db
  .from("profiles")
  .select("id, email, role, people(display_name)")
  .eq("client_id", client.id)
  .eq("status", "active")
  .in("role", ["client_manager", "client_member"]);

const { data: already } = await db
  .from("onboarding_sequence_state")
  .select("profile_id")
  .in("profile_id", (profiles ?? []).map((p) => p.id));
const enrolled = new Set((already ?? []).map((r) => r.profile_id));

const todo = (profiles ?? []).filter((p) => !enrolled.has(p.id));

console.log(`\nClient: ${client.name}`);
console.log(`Active portal users: ${profiles?.length ?? 0}`);
console.log(`Already enrolled:    ${enrolled.size}`);
console.log(`To enrol:            ${todo.length}\n`);
for (const p of todo) console.log(`  ${p.role.padEnd(15)} ${p.email}`);
if (!todo.length) process.exit(0);

console.log(
  "\nThey will start at day 0. Steps they already use settle silently on the" +
    "\nfirst run; they are emailed only about the parts they have not used.\n",
);

if (dryRun) {
  console.log("--dry-run: nothing written.");
  process.exit(0);
}

process.stdout.write(`Enrol these ${todo.length} people? (yes/no) `);
const answer = await new Promise((r) => process.stdin.once("data", (d) => r(d.toString().trim())));
if (answer !== "yes") {
  console.log("Aborted.");
  process.exit(0);
}

const { error } = await db
  .from("onboarding_sequence_state")
  .insert(todo.map((p) => ({ profile_id: p.id })));
if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}
console.log(`Enrolled ${todo.length}. They receive their first step on the next daily run.`);
process.exit(0);
```

- [ ] **Step 2: Write the dry-run script**

Create `scripts/onboarding-dry-run.mjs`:

```js
#!/usr/bin/env node
/**
 * Show exactly what the next drip run would do.
 *
 *   node scripts/onboarding-dry-run.mjs [--url https://portal.rocking.one]
 *
 * A thin client over /api/jobs/onboarding-drip?dry=1 — deliberately NOT a
 * second implementation of the decision logic, so the preview cannot disagree
 * with the real run.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const base = args.includes("--url") ? args[args.indexOf("--url") + 1] : "https://portal.rocking.one";

const res = await fetch(`${base}/api/jobs/onboarding-drip?dry=1`, {
  headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
});
if (!res.ok) {
  console.error(`${res.status} ${res.statusText}`);
  process.exit(1);
}
const r = await res.json();

console.log(`\nEnrolled:      ${r.enrolled}`);
console.log(`Would send:    ${r.wouldSend}`);
console.log(`Would settle:  ${r.wouldSettle}   (already using it, or opted out)`);
console.log(`Would stop:    ${r.wouldStop}     (no longer active)`);
if (r.capped) console.log("CAPPED — the 200-send limit was hit.");
console.log("");
for (const d of r.decisions ?? []) {
  console.log(`  ${d.outcome.padEnd(22)} ${d.step.padEnd(14)} ${d.email}`);
}
console.log("");
```

- [ ] **Step 3: Verify the enrolment script's guard rails without writing anything**

Run: `node scripts/onboarding-enrol.mjs --client "GSR" --dry-run`
Expected: prints the client, the counts and the list, then "--dry-run: nothing written."

Run: `node scripts/onboarding-enrol.mjs --client "o"`
Expected: refuses with "matches N clients — be more specific" (assuming more than one client name contains "o"). If only one does, try a shorter fragment.

- [ ] **Step 4: Commit**

```bash
git add scripts/onboarding-enrol.mjs scripts/onboarding-dry-run.mjs
git commit -m "feat(onboarding): add enrolment and dry-run scripts"
```

---

### Task 8: Live verification

Local dev reads `.env.local` and therefore talks to **production** Supabase. Everything here uses a throwaway profile that is deleted at the end. Do not run the enrolment script against a real client during this task.

**The route is not deployed yet** — the push is Step 10. So every call below goes to a **local** dev server, which still reads production Supabase and still sends real email through Resend. Start it first and leave it running:

```bash
npm run dev
```

**Files:** none — verification only.

- [ ] **Step 1: Confirm nobody is enrolled yet**

Run:

```bash
node -e '
const {createClient}=require("@supabase/supabase-js");
require("fs").readFileSync(".env.local","utf8").split("\n").forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)process.env[m[1]]=m[2].replace(/^["\x27]|["\x27]$/g,"")});
createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)
.from("onboarding_sequence_state").select("profile_id",{count:"exact",head:true})
.then(r=>console.log("enrolled:",r.count));'
```

Expected: `enrolled: 0`. Anything else means something enrolled people implicitly — stop and find out what before going further.

- [ ] **Step 2: Enrol one throwaway profile**

Use the existing `shawn@jooste.co` test profile on JoosteCo. Find its id and insert a state row backdated 20 days so every floor has passed:

```bash
node -e '
const {createClient}=require("@supabase/supabase-js");
require("fs").readFileSync(".env.local","utf8").split("\n").forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)process.env[m[1]]=m[2].replace(/^["\x27]|["\x27]$/g,"")});
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
const {data:p}=await db.from("profiles").select("id,role").eq("email","shawn@jooste.co").maybeSingle();
console.log("profile:",p);
const at=new Date(Date.now()-20*86400000).toISOString();
console.log(await db.from("onboarding_sequence_state").insert({profile_id:p.id,enrolled_at:at}));
})();'
```

- [ ] **Step 3: Dry-run against production and read the plan**

Run: `node scripts/onboarding-dry-run.mjs --url http://localhost:3000`

Expected: `Enrolled: 1`, `Would send: 1`, and one decision line naming `shawn@jooste.co` with step `support`. Confirm `Would send` is **1**, not more — the one-email-per-person rule.

- [ ] **Step 4: Run it for real, once**

Run:

```bash
curl -s -X POST -H "authorization: Bearer $(grep '^CRON_SECRET=' .env.local | cut -d= -f2- | tr -d '"')" \
  http://localhost:3000/api/jobs/onboarding-drip
```

Expected: `{"enrolled":1,"sent":1,...}`. Check the inbox for `shawn@jooste.co`: one email, subject "Getting help, without the phone tag", with no "welcome" language.

- [ ] **Step 5: Run it again immediately and confirm silence**

Run the same curl again.
Expected: `"sent":0`. The four-day gap holds it back. This is the single most important check — a runner that re-sends on every invocation would email everybody repeatedly.

- [ ] **Step 6: Confirm the recorded row**

```bash
node -e '
const {createClient}=require("@supabase/supabase-js");
require("fs").readFileSync(".env.local","utf8").split("\n").forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)process.env[m[1]]=m[2].replace(/^["\x27]|["\x27]$/g,"")});
createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY)
.from("onboarding_sequence_sends").select("*").then(r=>console.log(r.data));'
```

Expected: exactly one row, `step_key: "support"`, `outcome: "sent"`.

- [ ] **Step 7: Confirm it appears in the client's Communications**

Open `http://localhost:3000/communications` signed in as the test user (or check `sent_emails` for the row). Expected: the step email is listed — it went through `sendEmail`, so the client history is complete.

- [ ] **Step 8: Delete the throwaway rows**

```bash
node -e '
const {createClient}=require("@supabase/supabase-js");
require("fs").readFileSync(".env.local","utf8").split("\n").forEach(l=>{const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)process.env[m[1]]=m[2].replace(/^["\x27]|["\x27]$/g,"")});
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
(async()=>{
const {data:p}=await db.from("profiles").select("id").eq("email","shawn@jooste.co").maybeSingle();
console.log(await db.from("onboarding_sequence_sends").delete().eq("profile_id",p.id));
console.log(await db.from("onboarding_sequence_state").delete().eq("profile_id",p.id));
})();'
```

Expected: both deletes succeed. Re-run Step 1 and confirm `enrolled: 0` again.

- [ ] **Step 9: Full suite and build**

Run: `find .next -name "* 2.*" -delete; npx tsc --noEmit && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 10: Commit and push**

Stage explicit paths only — a parallel session may own other files in this repo, and `git add -A` would sweep their work into your commit.

```bash
git status --porcelain
git add docs/superpowers/plans/2026-08-11-onboarding-sequence.md
git commit -m "docs(onboarding): verified drip end to end"
git push
```

If `git status` shows changes you did not make, leave them unstaged and say so in your report.

---

## After the plan

The cron is live from the first deploy, but with nobody enrolled it does nothing — the only people who enter are those invited from then on. Enrolling an existing client is Shawn's explicit call:

```bash
node scripts/onboarding-enrol.mjs --client "GSR" --dry-run
```

Review that list with him before running it without `--dry-run`.
