# Admin Activity Feed — Design

**Date:** 2026-07-16
**Status:** Approved (Approach A — merge-on-read + one small capture table).

## Purpose

Admins can't currently answer "are clients actually using the portal?" — who
logs in, what they look at, what changed, whether the nightly syncs ran. An
admin-only **Activity** page shows all of it as one timeline. Primary job is
**engagement insight**, not an audit trail: light detail, deduped views,
completeness where it's cheap.

## Decisions

- **Merge-on-read.** Existing event tables stay the source of truth for their
  domains (`quote_events`, `rfq_events`, `device_changes`,
  `support_time_entries`, `import_runs`, `impersonation_log`). The feed reads
  and merges them at query time. No double-writing, no backfill.
- **New capture only for what nothing records today**: section visits, derived
  logins, and a handful of explicit portal actions.
- **Deduped section visits**: at most one row per user + section + hour. "Monique
  checked Billing this morning," not her whole clickstream. Table stays tiny;
  keep data forever (revisit only if size ever matters).
- **Logins are derived, not hooked**: a visit landing after ≥ 8 quiet hours for
  that user also writes a `login` event. No Supabase auth webhooks.
- **Staff browsing is not tracked** — client users only. Staff acting *as*
  clients is already covered by `impersonation_log`.
- **Clients never see any of this**; the table is staff-only via RLS and the
  page is admin-only.

## Data model

Migration (next number at build time): `portal_activity`

- `id uuid pk`
- `occurred_at timestamptz not null default now()`
- `profile_id uuid null references profiles on delete set null`
- `client_id uuid null references clients on delete cascade`
- `kind text not null check (kind in ('visit','login','action'))`
- `section text not null` — for visits: the nav section key (`home`,
  `devices`, `device`, `billing`, `quotes`, `support`, `m365`, `network`,
  `team`, `work`, `other`); for actions: a short verb slug
  (`ticket_created`, `photo_uploaded`, …)
- `detail text null` — human fragment, e.g. the quote number or hostname
- `hour_bucket timestamptz generated always as (date_trunc('hour', occurred_at)) stored`
- Unique index `(profile_id, kind, section, hour_bucket)` — the dedupe.
  Inserts use upsert-ignore-duplicates, so repeat visits inside an hour are
  free no-ops.
- Index on `occurred_at desc`.
- RLS: staff-only (`is_rocking_staff()`) for select; **no client policies at
  all** — writes happen server-side via the service client only (the visit
  hook runs in a layout where the *client's* session is active, so the
  RLS client would be wrong for a staff-only table).

## Capture

**Path plumbing:** `middleware.ts` sets `x-pathname` on the request headers so
server layouts can read the current path (they can't otherwise).

**Visit hook:** `lib/track.ts` exports `trackVisit(profile, pathname)`:
- No-op for staff, unauthenticated, or missing client_id.
- Maps pathname → section key (first path segment, with `/devices/[id]` →
  `device` etc.); unknown paths → `other`.
- Upsert (ignore duplicates) the visit row via the **service client**.
- Login derivation: when the upsert actually inserts (not a duplicate), check
  the user's most recent prior activity; if none within 8 hours, insert a
  `login` row too.
- Fire-and-forget semantics: failures are swallowed (`console.error`) — the
  portal must never break or slow down because tracking hiccuped. Called from
  `app/(app)/layout.tsx` (the client-surface layout), so every client page
  render passes through it.

**Explicit actions (day one):** `trackAction(profile, section, detail)` called
from `createTicketAction` (`ticket_created`, detail = subject). Other actions
can be added one line at a time later; most mutations already have domain
event tables that the feed reads directly.

## The feed — `/admin/activity`

Admin-only page (staff guard + nav item under the Clients group, label
"Activity").

**Sources merged at read (last N days, default 7, selectable 1/7/30):**

| Source | Feed line (examples) |
|---|---|
| `portal_activity` kind=login | "Monique Siers (GSR Law) signed in" |
| `portal_activity` kind=visit | "viewed Billing" |
| `portal_activity` kind=action | "raised ticket: 'VPN down'" |
| `quote_events` | "Quote Q-2026-001 sent / viewed / accepted" |
| `rfq_events` | "RFQ 'Laptop assessments' → quoted" |
| `device_changes` | "Change logged on GG5235: hinges…" |
| `support_time_entries` | "45m remote logged for JoosteCo" |
| `import_runs` | "Datto sync — 67 devices" |
| `impersonation_log` | "Shawn viewed portal as GSR Law" |

Each source maps to a common shape
`{ at, kindGroup, actor, clientId, clientName, text, href? }` in
`lib/views/activity.ts`; sorted desc, grouped by day headers.

**Filters:** kind-group chips — All · Logins · Views · Actions · Changes ·
Quotes · Syncs — plus a client dropdown. Plain `searchParams`, server-rendered,
no client state library.

**Volume guard:** each source query is capped (500 rows per source per load);
if a cap is hit the page shows "showing the most recent…" rather than
silently truncating.

## Testing

- Vitest on pure logic: pathname → section mapping; the merge/sort/grouping;
  login-gap rule (pure function taking "minutes since last activity").
- Manual: browse as a client user → visit rows appear deduped; second page
  view within the hour adds nothing; sign in after idle produces a login row;
  feed renders all sources; filters and client dropdown narrow correctly;
  non-staff hitting `/admin/activity` is redirected.

## Out of scope

- Full clickstream / every-URL logging, retention pruning, CSV export.
- Client-visible activity ("your team's activity") — staff only.
- Charts/aggregates (weekly active clients etc.) — the table gets us the data;
  visualization can come later once there's data worth charting.
- Tracking staff browsing.
