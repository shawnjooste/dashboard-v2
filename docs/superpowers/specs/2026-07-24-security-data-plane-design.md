# Security Data Plane (MDR Sub-project A) — Design

**Date:** 2026-07-24
**Status:** Approved in conversation (Shawn).

## Strategic context (read me first)

Rocking is pivoting toward the security space: the portal evolves into an
**agent-powered MDR console** in the spirit of Arctic Wolf — clients keep their
own tools (Datto, M365, network gear, later INKY/Meraki/SaaS Alerts…); we
ingest the telemetry, agents do tier-1 triage, humans respond. Decisions made
2026-07-24:

- **Evolve THIS portal** for existing managed clients — not a standalone
  product/brand (revisit once proven).
- The MDR effort is decomposed into sub-projects, each its own
  spec → plan → build:
  **A** security data plane (this spec) → **B** SOC console → **C**
  detection/triage agents (successor of the parked client-agent design) →
  **D** incident response workflow → **E** client-facing posture page.
- Build order rationale: data plane first, on signals we ALREADY ingest.
  No agents until the data they reason over is normalized (agents-first is
  the classic failure mode). No new integrations in A.

## Purpose of sub-project A

One normalized, queryable stream of security signal across every client and
source: the foundation the console renders, agents annotate, and incidents
reference. Plus a thin staff-only viewer to watch it fill.

## Core decisions

- **Materialized `security_events` table**, written by a normalization pass —
  NOT merge-on-read (unlike the activity feed). Events must be persistable
  as scored/triaged/annotated for sub-projects C/D.
- **Two kinds in one model:**
  - `activity` — a discrete thing happened (alert fired, account disabled,
    device went down). Immutable once written.
  - `posture` — a standing weakness (user has no MFA, AV off, security
    defaults off). One row per weakness, upserted; flips to resolved when a
    later sync sees it fixed.
- **Triage is Rocking's layer, separate from source truth:** `triage_state`
  (`new → acknowledged → escalated → dismissed`) tracks whether WE have dealt
  with it, independent of whether the source still fires / the weakness is
  still open. Agents (C) will later write acknowledged/escalated + notes;
  in A, staff set it by hand in the viewer.
- **v1 latency = nightly** (normalizer runs after the existing pulls).
  Real-time is a later phase; stated honestly, not hidden.

## Schema

Migration (next free number at build time — parallel sessions are active,
CHECK `ls supabase/migrations` and the remote list first):

`security_events`
- `id uuid pk`
- `client_id uuid not null references clients on delete cascade`
- `kind text not null check in ('activity','posture')`
- `source text not null` — `datto` | `m365` | `network` | `portal` (open set,
  no check constraint: new sources must not need migrations)
- `category text not null` — `malware` | `monitoring` | `auth` | `identity`
  | `config` | `availability` | `other` (open set, same reason)
- `severity text not null check in ('info','low','medium','high','critical')`
- `entity_type text` (`device` | `user` | `site` | …), `entity_id text`
  (source-side id), `entity_label text` (hostname / UPN — denormalized for
  display so the feed never joins source tables)
- `title text not null`, `detail text`
- `context jsonb` — source-specific extras (alert policy, mfa methods, …)
- `occurred_at timestamptz not null` — activity: when it happened; posture:
  when first observed
- `source_ref text not null` — stable dedup key, unique with `client_id`
  (activity e.g. `datto:alert:<device>:<triggered_at>:<hash(message)>`;
  posture e.g. `m365:mfa_off:<user_id>`); upserts are idempotent, re-running
  the normalizer never duplicates
- Posture lifecycle: `resolved boolean not null default false`,
  `resolved_at timestamptz` (always false for activity rows)
- Triage: `triage_state text not null default 'new'`
  check in (`new`,`acknowledged`,`escalated`,`dismissed`);
  `triage_note text`, `triaged_by uuid references profiles on delete set null`,
  `triaged_at timestamptz`
- `created_at`, `updated_at`
- Indexes: `(client_id, occurred_at desc)`; `(severity, triage_state)`;
  unique `(client_id, source_ref)`
- RLS v1: **staff-only** (`is_rocking_staff()` for all). Client visibility is
  sub-project E's problem — do not design client policies yet.
  Normalizer writes via service role.

## Severity + mapping (pure, tested)

`lib/security/severity-map` (pure, vitest-covered): per-source mapping tables
from raw signals to `{category, severity}`. Initial mapping:

| Source signal | kind | category | severity |
|---|---|---|---|
| Datto alert priority Critical | activity | monitoring | critical |
| Datto alert priority High | activity | monitoring | high |
| Datto alert priority Moderate/Low/other | activity | monitoring | medium/low/low |
| Datto AV not running/not installed | posture | config | high |
| Datto patch status InstallError / RebootRequired | posture | config | medium/low |
| M365 licensed user MFA not strong | posture | identity | high |
| M365 password-only user | posture | identity | critical |
| M365 security defaults off (tenant, when no CA equivalent) | posture | config | medium |
| M365 account_enabled flip (vs previous sync) | activity | identity | medium |
| Network device offline/alerting | activity | availability | medium |

Numbers/levels are data in one file — tuning severity is an edit + test, not
an architecture change.

## The normalizer

`scripts/security-normalize.mjs` — a SEPARATE pass, not inline in the pull
scripts (decoupled failure domains, re-runnable over history, independently
testable). Reads the source tables (`device_alerts`, devices' AV/patch state,
`m365_users`, `m365_tenant/snapshots`, `network_devices`), maps via the pure
helpers, upserts `security_events` on `(client_id, source_ref)`:
- activity rows: insert-if-absent (ignore duplicates).
- posture rows: present-in-source → upsert as unresolved; previously-written
  posture rows whose weakness no longer appears → `resolved = true,
  resolved_at = now()` (triage_state untouched). A finding is only ever
  resolved if the run positively re-evaluated that exact entity with a
  definite (non-null) state this pass — an entity absent from a source read
  (outage, auth failure) or reporting an ambiguous null field is left
  untouched, never resolved. "Unknown" must never read as "fixed".
- **`account_enabled` flips (v1 semantics, amended 2026-07-24 after
  adversarial review):** without a snapshot of prior state, A cannot
  distinguish "newly disabled since last run" from "has been disabled for
  months" — it emits one activity row the first time a licensed account is
  seen disabled, and does not detect a later re-enable/re-disable. Accepted
  for A; proper flip detection (a small prior-state table, or reading it
  back from existing `security_events`) is deferred to whichever later
  sub-project needs it.
- Prints a per-source summary (like datto-pull) and logs an `import_runs` row
  (`source = 'security-normalize'`) so the activity feed shows the run.
- Scheduling: launchd `com.rocking.security-normalize` at 03:00 (after datto
  02:15 / m365 02:30 / xero 02:45), plus manual runs anytime.
- account_enabled flip detection needs the previous state: compare against the
  existing `security_events` posture/context rather than adding new snapshot
  tables (keep A lean).

## Thin viewer — `/admin/security`

Staff-only page (nav: Services group, label "Security"), deliberately minimal
— the real SOC console is sub-project B:
- Table of events, newest first: severity pill, kind, client, entity, title,
  source, triage state; filters (searchParams, server-rendered): severity,
  kind, client, triage state, open-vs-resolved posture. Cap 500 with note.
- Row action: set triage state (+ optional note) via staff-guarded action —
  proves the triage layer end-to-end before agents exist.
- Summary strip: counts by severity for the current filter.

## Testing

- Vitest: severity-map table (every row above), source_ref builders
  (stability/uniqueness), posture-resolution diff logic (pure function over
  current-source-set vs existing-rows).
- Live verification after first normalize run: spot-check counts vs source
  tables (e.g. unresolved AV-off posture events == devices with AV off), a
  re-run produces zero new rows (idempotency), one manual triage round-trip.
- Adversarial review before push (data-integrity focus: dedup, resolution
  flips, severity mapping fidelity, RLS staff-only).

## Out of scope (later sub-projects)

SOC console (B); agents writing triage (C); incident grouping/response (D);
client-facing anything incl. client RLS (E); new integrations (SaaS Alerts,
INKY, Meraki — SaaS Alerts is the designated first addition later);
real-time/faster-than-nightly ingestion; alert notifications (email/push) on
new criticals — B's problem; retention/pruning.
