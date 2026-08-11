# Onboarding Email Sequence — Design

**Date:** 2026-08-11
**Status:** Approved in conversation (Shawn).

## Goal

A new person invited to the portal today gets one welcome email and nothing
more. Nobody tells them what the portal actually does, so most of it goes
unused. This adds a paced series of short emails that walks each person
through the sections **they can actually see**, skips anything they're
already using, and fires later if a feature is switched on for them months
afterwards.

## The model

Not a linear drip with a pointer. A **catalogue of feature-triggered steps,
re-evaluated daily**. Each step names the feature it belongs to; eligibility
is recomputed on every run, so granting `connectivity` to someone in month
eight makes that step eligible the next morning.

This removes two things a linear design would have needed: a
`next_step_index` column (the sends table is the state) and a
manager/member track (`canAccess()` already answers who can see what, so
members fall out naturally without a second code path).

## Step catalogue

Each step declares a feature gate, a data gate, and the `portal_activity`
section that counts as "already using it".

| Step | Earliest | Feature gate | Data gate | Skip if visited |
| --- | --- | --- | --- | --- |
| Welcome | on invite | — | — | — (always sends) |
| Support | day 3 | none — everyone | — | `support` |
| Devices & security | day 7 | `devices` | ≥1 device for the client | `devices` |
| Billing | day 11 | `billing` | `clients.xero_contact_id` set | `billing` |
| Connectivity | day 15 | `connectivity` | none | `connectivity` |
| Your team | day 19 | `team` | — | `team` |

`MEMBER_DEFAULTS` is empty, so in practice a member receives the welcome and
the support step only. That is intended.

**Deliberately excluded.** Quotes and Agreements both already send their own
email the moment one arrives — a tour email teaches less than the real event
does. M365 and Network are too technical for a welcome tour. Any of the four
is a one-line addition to the catalogue if that changes.

**"Earliest" is a floor, not a schedule.** A feature granted long after
onboarding has its floor already in the past and fires on the next run.

**Copy constraint that follows from this:** every step must read correctly
both as a tour step and as a "this is now available to you" note. *"Here's
what Connectivity shows you"* works on day 15 and in month eight. *"Welcome
aboard — now let's look at Connectivity"* does not. No step may reference
being new, or the order of the other steps.

## Pacing

Two rules, both in the pure decision function:

- **At most one email per person per run.** Four features granted at once
  produce four emails over a fortnight, in catalogue order — not four that
  afternoon. Skips are free: a single pass settles every
  `skipped_already_using` step it walks past and stops at the first step that
  would send. This matters most when enrolling an established client, whose
  steps are mostly skips — they settle at once instead of one per day.
- **At least four days since that person's last `sent` step.** Skips don't
  reset the clock.

## Architecture

### Data (`0086_onboarding_sequence.sql`)

`onboarding_sequence_state` — one row per enrolled profile:

```
profile_id   uuid primary key references profiles(id) on delete cascade
enrolled_at  timestamptz not null default now()
status       text not null default 'active' check (status in ('active','stopped'))
```

No `next_step` column and no `done` status: the sequence stays open
indefinitely so a late feature grant can still fire. `stopped` is for
profiles that are no longer active.

`onboarding_sequence_sends` — one row per step **settled**:

```
profile_id  uuid not null references profiles(id) on delete cascade
step_key    text not null
decided_at  timestamptz not null default now()
outcome     text not null check (outcome in
              ('sent','skipped_already_using','suppressed'))
primary key (profile_id, step_key)
```

The composite primary key is the duplicate-send guarantee: a double cron run
cannot send twice regardless of what the code does.

**Only settled outcomes get a row, and this distinction is the heart of the
design.** A step is settled when it will never need reconsidering: it was
sent, or the person is already using that section, or they've opted out.
Failing a **feature gate or a data gate is not a decision** — it means *not
eligible yet*. Those steps are passed over silently, leaving no row, so
granting `connectivity` in month eight (or the client's first device
appearing) makes that step eligible on the next run. This is what makes late
grants fire, and it is why the outcome enum has three values rather than
five.

Both tables are staff-read-only under RLS, consistent with
`portal_activity`.

### The decision (`lib/onboarding/sequence.ts`)

The whole of the logic is one pure function with no Supabase import, no I/O,
and no clock of its own:

```ts
export type StepDecision = { stepKey: string; outcome: Outcome };

/** Any number of skips, and at most one send — always last. */
export function dueSteps(input: {
  now: Date;
  enrolledAt: Date;
  role: string;
  overrides: Overrides;
  decided: Set<string>;            // step_keys already in the sends table
  lastSentAt: Date | null;         // last 'sent' outcome for this person
  visitedSections: Set<string>;    // from portal_activity
  hasDevices: boolean;
  hasXero: boolean;
}): StepDecision[];
```

It walks the catalogue in order, ignoring steps that already have a row and
steps whose feature or data gate fails (those stay eligible for a future
run). Every remaining step whose floor has passed and which the person is
already using is returned as a `skipped_already_using` decision; the walk
stops at the first step that would actually send, which is returned only if
the four-day gap is satisfied. So a call returns any number of skips and at
most one send. It returns an empty list when nothing is due, and
`suppressed` is decided by the caller, which knows the opt-out state.

The catalogue itself lives beside it as an ordered array of
`{ key, minDays, feature, dataGate, section, content }`. Editing the tour is
a code change and a deploy, not a data migration.

### The runner (`app/api/jobs/onboarding-drip/route.ts`, daily cron)

A thin shell around the pure function:

1. Load `active` state rows, joined to profile role, overrides, opt-out and
   client.
2. For each, gather `visitedSections`, `lastSentAt`, `hasDevices`, `hasXero`.
3. Call `dueStep`. If it returns a step with outcome `sent`, send via
   `sendEmail` and insert the row; if it returns a skip, insert the row and
   send nothing.
4. Stop (`status = 'stopped'`) any row whose profile is no longer `active`.

Scheduled `0 7 * * *` (09:00 SAST) in `vercel.json`, alongside the four
existing crons.

Reads are batched per run — one query per table across all due profiles,
not one per person — and every unbounded select is explicitly ranged, per
the PostgREST max-rows trap.

### Enrolment

Two ways in, and only two.

**Automatic, on invite.** Both existing invite paths —
`app/(admin)/admin/users/actions.ts:109` and `app/(app)/team/actions.ts:74`
— insert a state row immediately after the welcome email succeeds. Enrolment
failure must never block or fail an invite: the insert is best-effort and
logged.

**Manual, one client at a time** — `scripts/onboarding-enrol.mjs`:

```
node scripts/onboarding-enrol.mjs --client "GSR" [--dry-run]
```

Resolves the client by name (refusing ambiguous matches rather than
guessing), lists every active profile with its role, whether it already has a
state row, and which step it would receive first, then asks for confirmation
before writing. `--dry-run` prints the same table and writes nothing. Already
enrolled profiles are reported and left alone, so re-running is safe.

Enrolling an established client sets `enrolled_at` to now, so the day floors
run from today. Their steps are mostly `skipped_already_using` and settle in
the first pass, which means a long-standing client hears only about the parts
of the portal they have been ignoring. That is the intended behaviour of this
route, not a side effect.

There is no third way in. Nothing enrols a profile implicitly.

## Opt-out

Steps 2–5 are sent with category `onboarding_step`, added to
`SUPPRESSIBLE_CATEGORIES` in `lib/email/suppression.ts` alongside
`portal_update`. The existing **Portal Updates** toggle therefore silences
them — one switch, already on the Communications page and the admin users
list. No second preference.

The **welcome email is unchanged**: category `onboarding`, never
suppressible, always sends, because it carries the sign-in link.

When a person has opted out, the runner records the step with outcome
`suppressed` and sends nothing — so an opted-out person's sequence advances
and finishes rather than stalling on the same step forever. `sendEmail`'s
existing suppression remains the actual guarantee; this is the bookkeeping
around it.

## Safety rails

An autoresponder's failure mode is emailing everybody, so:

1. **No backfill.** The 186 existing users get no state rows and never enter
   the sequence. Only new invites, plus whatever `onboarding-enrol.mjs` is
   explicitly pointed at, one client at a time. Switching this on emails
   nobody who is already on the portal.
2. **Composite primary key** on `(profile_id, step_key)` — duplicates are
   impossible at the database level.
3. **Per-run cap of 200 sends**, logging loudly when hit.
4. **`scripts/onboarding-drip.mjs --dry-run`** printing exactly who would
   receive what on the next run, and the reason behind every skip. Run and
   reviewed before the cron is enabled.

## Testing

- **Vitest on `dueSteps`**, which is where all the risk lives: not yet due;
  due; settled as `skipped_already_using`; a failed feature gate leaving no
  row and staying eligible; the same for a failed data gate; nothing left;
  never more than one `sent` in a returned list; several skips settling
  alongside one send in a single call; the four-day gap measured on sends
  only; a feature granted long after enrolment firing on the next run; a
  settled step never reconsidered; an established enrolee settling every skip
  in one pass.
- **Vitest on the catalogue** asserting every step's feature is in `FEATURES`
  and every `section` matches a real `portal_activity` section value.
- **Live:** enrol a throwaway profile, run the dry-run, confirm the predicted
  step, run for real, confirm one email and one `sent` row, confirm a second
  immediate run sends nothing. Then delete the throwaway rows. Local dev
  talks to production Supabase, so this must use throwaway records only.
- Build and full suite green before push.

## Out of scope

Per-step admin UI (the Activity feed and Communications already show every
send); an admin screen for enrolment, which the script covers until enrolling
clients becomes routine; a second opt-out preference; re-sending a step
settled as `skipped_already_using` if that usage later lapses; branching or
conditional content within a step; A/B testing subject lines; the finished
copy for each step, which is drafted and approved separately before the cron
is enabled.

The catalogue is expected to grow as the portal does. Adding a step is an
entry in the array plus its copy — no migration, and existing enrolees pick
it up on the next run, since a step with no row for them is simply eligible.
