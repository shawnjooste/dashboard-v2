-- NED storm watch: one row per capture iteration from the Steenberg
-- broadcast-storm watch loop (NED = Shawn's network-engineering Claude
-- session; writer script lives in the NED workspace, not this repo).
-- Written by the service role only (bypasses RLS) — no insert/update/delete
-- policies for authenticated. Staff-read-only, matching onboarding_sequence_*.
-- Spec: docs/superpowers/specs/2026-08-19-ned-network-watch-page.md

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

alter table public.ned_storm_watch enable row level security;

create policy "staff read ned storm watch" on public.ned_storm_watch
  for select using (public.is_rocking_staff());
