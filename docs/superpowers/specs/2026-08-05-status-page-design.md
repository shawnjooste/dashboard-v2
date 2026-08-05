# Status Page — Design

**Date:** 2026-08-05
**Status:** Approved in conversation (Shawn).

## Purpose

Rocking needs one place to tell clients what's broken, what's degraded, and
what's planned — instead of ad-hoc emails and WhatsApp messages. Staff post
incidents and update them as things develop; clients read them, see the
history, and can opt into email updates. A dot in the top bar tells anyone at
a glance whether anything is wrong *for them*.

## Decisions

Made in the 2026-08-05 brainstorm — later sessions should not relitigate:

- **Incidents are global or client-scoped.** Global = everyone sees it (M365
  degraded, helpdesk phone down). Client-scoped = only the targeted clients
  see it (fibre down at GSR). Most MSP outages are client-specific; showing
  them to all ~180 clients would be noise and false alarm.
- **Three types:** `outage` (red), `degraded` (amber), `maintenance` (blue).
  Binary green/red was rejected — a five-minute slowdown must not look
  identical to a full outage, and planned work must not alarm people.
- **Maintenance is a plain post for now.** No future-dated windows, no
  auto-activation cron; the window goes in the message text. Real scheduling
  is a later phase if it earns its place.
- **An incident is a thread, not a row.** Creating an incident writes its
  first update in the same transaction, so an incident is never a headline
  with no story. Every subsequent development is another update. Resolution
  is an update too.
- **History is permanent.** Resolved incidents are never deleted.
- **Email is opt-in per user, unsubscribe via the same portal toggle.** No
  tokenised one-click link in v1 (that needs a public route + signed token,
  same care as the Paystack webhook). Every email links to `/status`.
- **Known limitation, accepted:** if the portal itself is down, nobody can
  read this page. That case stays a WhatsApp/email job. A public status page
  on separate hosting is the real answer and is explicitly out of scope.

## Data model

Migration `0079_status_page.sql` (verify the number is still free at build —
parallel sessions are active; check `ls supabase/migrations` and
`npx supabase migration list --linked`).

**`status_incidents`**
- `id uuid pk`
- `title text not null`
- `type text not null check in ('outage','degraded','maintenance')`
- `status text not null default 'active' check in ('active','resolved')`
- `scope text not null check in ('global','clients')`
- `started_at timestamptz not null default now()`
- `resolved_at timestamptz`
- `created_by uuid references profiles on delete set null`
- `created_at`, `updated_at`
- Index on `(status, started_at desc)`.

**`status_incident_clients`** — targets for `scope = 'clients'`
- `incident_id uuid not null references status_incidents on delete cascade`
- `client_id uuid not null references clients on delete cascade`
- primary key `(incident_id, client_id)`

**`status_updates`** — the thread
- `id uuid pk`
- `incident_id uuid not null references status_incidents on delete cascade`
- `body text not null`
- `is_resolution boolean not null default false`
- `created_by uuid references profiles on delete set null`
- `created_at timestamptz not null default now()`
- Index on `(incident_id, created_at desc)`

**`status_subscriptions`** — per-user opt-in
- `profile_id uuid primary key references profiles on delete cascade`
- `created_at timestamptz not null default now()`

A row present = subscribed. Unsubscribing deletes the row.

### Visibility and RLS

One rule, applied to all three incident tables:

> Staff see everything. A client user sees an incident when it is `global`,
> or when their `current_client_id()` appears in `status_incident_clients`.

- `status_incidents`: select per the rule above; insert/update/delete staff-only.
- `status_incident_clients`: select where the parent incident is visible;
  writes staff-only.
- `status_updates`: select where the parent incident is visible; writes
  staff-only.
- `status_subscriptions`: a user selects/inserts/deletes **only their own row**
  (`profile_id = auth.uid()`); staff may select all (needed to resolve
  recipients server-side, though sends use the service client).

## Surfaces

**1. Top-bar indicator** (`components/AppShell.tsx`)

A `Status` link immediately left of the avatar, prefixed with a coloured dot.
Colour = worst *visible-to-the-viewer* active incident:
`outage` red → `degraded` amber → `maintenance` blue → none green. A
client-scoped GSR outage therefore shows red for GSR and green for everyone
else. Resolved by one small query in the app layout and passed into
`AppShell` as a prop (the shell stays presentational, matching how
`allowedHrefs`/`billingEnabled` already work).

**2. `/status`** — one route serving both audiences.

- **Current state:** "All systems operational" when nothing is active,
  otherwise active incidents worst-first, each showing type, title, when it
  started, affected scope ("All clients" or the client names for staff /
  "Your account" for clients), and its update thread newest-first.
- **History:** resolved incidents, most recent first, each expandable to its
  full thread. Never truncated by deletion; capped per page at 50 with a
  "show more" if it ever grows past that.
- **Client users** additionally see an **Email me updates** toggle reflecting
  their subscription. Updates in place without a route refresh (same
  local-state pattern as the clients-list archive fix — a preference toggle
  must not cost the reader their place).
- **Staff** additionally see: a **Post incident** form (title, type, scope
  with a client picker when scope = clients, and the first update body), and
  per active incident **Post update** and **Resolve** (resolve takes a final
  message, writes it as `is_resolution`, stamps `resolved_at`, sets status).

Nav: the top-bar link is the entry point for everyone. No sidebar entry —
status is ambient, not a section you go browsing.

## Email

Reuses `sendEmail` in `lib/notify.ts`, inheriting the branded template,
reply-to `support@rocking.co.za`, and automatic activity-feed logging
(`category: "status"`).

**Recipients** = users with a `status_subscriptions` row, intersected with
visibility:
- `scope = 'global'` → every subscriber.
- `scope = 'clients'` → only subscribers whose `client_id` is targeted.
- Staff are never emailed (they are the ones posting).

**Triggers:** incident created, every subsequent update, and resolution.

**Best-effort:** a send failure is logged and never blocks the post. During an
outage, communicating must not depend on the mailer being healthy.

**Content:** what's affected, the type, the update text, and a link to
`/status`. The subject carries the state, e.g.
`[Outage] Fibre down at GSR Law` and `[Resolved] Fibre down at GSR Law`.

## Testing

Pure helpers (import-free, vitest — repo convention):

- `lib/status-helpers.ts`: `worstType(types)` → the dot colour rule, including
  empty input → green and unknown types ignored; `dotTone(type)` mapping;
  `subjectPrefix(type, status)`.
- `lib/status-recipients.ts`: `resolveRecipients(subscribers, incident)` —
  global includes everyone; client-scoped includes only targeted clients;
  non-subscribers excluded; staff excluded; nobody appears twice.

Live verification before push:
1. Post a client-scoped incident targeting JoosteCo → dot red for a JoosteCo
   user, green for another client, visible on `/status` for JoosteCo only.
2. Only the JoosteCo subscriber receives the email; a non-subscriber and an
   unaffected client's subscriber receive nothing.
3. Post an update → second email, thread shows both entries newest-first.
4. Resolve → dot returns to green, incident moves to history, resolution
   email sent.
5. RLS spot-check with a real client JWT: an unaffected client reads zero
   rows for that incident from `status_incidents` and `status_updates`.
6. Test data removed afterwards.

## Out of scope

Scheduled maintenance windows with auto-activation; tokenised one-click
unsubscribe; a public (unauthenticated) status page; per-service components
("Email", "Internet", "Portal" as separate tracked services); uptime
percentages or historical availability stats; SMS/push; client-submitted
incident reports; auto-created incidents from the security data plane
(interesting later — the normalizer already knows when a site goes down).
