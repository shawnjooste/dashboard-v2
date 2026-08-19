# NED network watch page (admin-only) + storm-watch data pipe

**Date:** 2026-08-19 · **Author:** NED session (Claude) with Shawn

## What

An admin-only page at `/admin/ned` ("NED" link in the staff nav) showing live
network-engineering telemetry, starting with the **Steenberg broadcast-storm
watch**: an hourly packet-capture loop (running in Shawn's NED Claude session)
measures ARP/broadcast rates on the Steenberg LAN and router health from
LibreNMS, and writes one row per iteration to Supabase. The page renders the
current verdict, the trend, and the standing diagnosis.

## Why

Serious network issues at the Steenberg site were traced (2026-08-19, was
2026-06-22 in NED log; see NED workspace) to an ARP broadcast storm from the
Great Westerford core router flooding across the L2-bridged backhaul. Andre is
deploying edge filters; the hourly watch tracks whether they bite. Shawn wants
this visible in the portal instead of a local HTML file.

## Decisions

- **Table `ned_storm_watch`**, one row per capture iteration. Written by the
  NED loop using the **service role key** (bypasses RLS); no insert policy for
  authenticated users.
- **RLS: `rocking_staff` read-only** (same pattern as other admin-only tables);
  clients must never see network internals. Enforced in RLS, not just nav.
- Status derivation lives in the DB row (`status` text: `active` | `improving`
  | `cleared`, thresholds >100 / 20–100 / <20 ARP/s) so the page renders what
  the loop measured — no client-side re-derivation drift.
- Page is a server component reading via the standard server Supabase client
  (RLS applies); no client JS beyond what the shell provides. Trend chart is
  dependency-free (CSS bars / inline SVG), matching existing admin pages.
- Nav: "NED" entry in the staff nav in `AppShell.tsx`.
- Migration `0093` (checked local + linked — both end at 0092).
- The writer script lives in the NED workspace (`NED/bin/ned-push-storm`), not
  this repo; it reads `SUPABASE_URL`/service key from this repo's `.env.local`
  at runtime. Documented here so portal sessions know where writes come from.

## Schema (contract)

```sql
create table public.ned_storm_watch (
  id            bigint generated always as identity primary key,
  captured_at   timestamptz not null,
  duration_secs integer     not null,
  total_frames  integer     not null,
  arp_frames    integer     not null,
  arp_from_gwf  integer     not null,
  arp_per_sec   numeric(8,1) not null,
  broadcast_pct numeric(5,1) not null,
  distinct_targets integer  not null,
  arp_replies   integer     not null default 0,
  tcp_retrans   integer     not null default 0,
  bgp1_status   text        not null default 'unknown',
  steenberg_status text     not null default 'unknown',
  status        text        not null check (status in ('active','improving','cleared')),
  note          text,
  created_at    timestamptz not null default now()
);
```

## Out of scope (now)

- Writing captures/pcaps to the portal (headers-only stats only — pcaps stay
  on webinatortoo).
- Client-facing exposure of any of this.
- Automating the capture loop server-side (it needs tailnet SSH; it stays in
  the NED session on Shawn's Mac).
