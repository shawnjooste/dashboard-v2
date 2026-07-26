# SOC Console (MDR Sub-project B) — Design

**Date:** 2026-07-24
**Status:** Approved in conversation (Shawn).

## Context

Sub-project A (shipped 2026-07-24) built the security data plane: a
normalized `security_events` stream (activity + posture kinds, `source_ref`
dedup, Rocking `triage_state` layer) refreshed nightly by
`scripts/security-normalize.mjs`, with a deliberately bare `/admin/security`
list to prove it worked. See
`docs/superpowers/specs/2026-07-24-security-data-plane-design.md`.

B turns that raw list into the surface Rocking actually works from: "what is
the security situation, across every client, right now."

## Decisions

- **B is visibility only.** No new tables, no new columns, no "incident"
  concept — grouping related events into an incident with a lifecycle is
  explicitly sub-project D's job and must not leak in sideways here. B reads
  what A already writes.
- **Security appears in three places**, each reusing existing patterns:
  admin Overview (the daily "what needs me" screen), `/admin/security`
  (the full picture), and the per-client admin page (one more section
  alongside Support/Connectivity/Products).
- **Per-client summary is severity counts, not a score.** No posture
  score/grade formula in B — a rolled-up score would have to be invented,
  tuned, and defended now, and sub-project E (client-facing posture) is the
  right place to decide whether clients ever see such a thing.
- **No notifications in B** (A deferred "alert on new criticals" to B; B
  defers it again, deliberately). In-portal only. Notification thresholds
  should be chosen after the dashboard shows what actually matters, and
  real-time alerting would anyway contradict A's honest nightly latency.
- **One shared query, three thin consumers** — not one generic widget
  rendering three different layouts.

## Data

No migration. One new view-layer function in `lib/views/security.ts`:

```
getSecurityOverview(): Promise<{
  totals: Record<Severity, number>;          // open events, all clients
  byClient: Array<{
    clientId: string;
    clientName: string;
    counts: Record<Severity, number>;        // open events for this client
    topItems: SecurityEventRow[];            // worst-first, max 3
  }>;                                        // sorted worst-first
}>
```

Reads `security_events` where `resolved = false`, staff-only by RLS (same as
A). "Open" excludes resolved posture findings; activity events are never
resolved, so they always count — acceptable for v1 since activity rows are
the recent-history signal. Sorting: clients ranked by critical count, then
high, then medium.

A small pure helper (`lib/security/rollup.ts`, vitest-covered) does the
grouping/sorting/ranking so the view layer stays a thin query and the
ordering rules are testable: `rollupByClient(events, clientNames)` and
`worstFirst(a, b)`.

## Surfaces

**1. Admin Overview** (`app/(admin)/admin/page.tsx`)
- Sixth KPI tile `SECURITY`: value = open critical + high across all
  clients; dot red (`#B91C1C`) when > 0, else neutral. Grid goes
  `lg:grid-cols-5` → `lg:grid-cols-6`.
- New `DashboardPanel` "Security needs attention": `hot` when non-empty,
  top 3 open critical/high items across all clients (title, client ·
  severity as secondary), `viewAll` → `/admin/security`, empty state
  "Nothing critical open — the fleet looks clean."

**2. `/admin/security`** (`app/(admin)/admin/security/page.tsx`)
- Keep the existing severity summary strip, filters, event list, triage
  controls exactly as they are.
- Insert above them a "By client" Card: table of client · critical · high ·
  medium · low, worst-first, each row linking to `?client=<id>` (the filter
  the page already supports). Counts of 0 render muted; critical/high
  non-zero render in brand/warn colour. Only clients with at least one open
  event appear.

**3. Client page** (`app/(admin)/admin/clients/[id]/SecuritySection.tsx`, new)
- Compact Card "Security": severity counts for that client, the up-to-3
  worst open items (severity pill + title + entity), and a link to
  `/admin/security?client=<id>`.
- Empty state: "No open security findings."
- Rendered in `app/(admin)/admin/clients/[id]/page.tsx` after
  `SupportSection` (security sits with the other service sections).

## Testing

- Vitest on `lib/security/rollup.ts`: grouping by client, worst-first
  ordering (critical dominates high dominates medium; ties broken by name),
  topItems capped at 3 and severity-ordered, clients with zero open events
  excluded, empty input.
- Manual: Overview tile + panel reflect real counts; `/admin/security`
  by-client rows link through to a correctly filtered list; client page
  section matches the same client's row in the global table; non-staff
  redirected from every surface (existing guards).
- Build + full suite green before push.

## Out of scope

Incidents/grouping (D), notifications of any kind, client-facing security
views or RLS changes (E), agent-written triage (C), new signal sources,
charts/trends over time, faster-than-nightly refresh.
