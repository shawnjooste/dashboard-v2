-- Engagement capture for the admin activity feed: section visits (deduped to
-- one row per user+section+hour), derived logins, and explicit portal actions.
-- Client users only — staff browsing is never tracked. Writes happen strictly
-- server-side via the service client; there are NO client RLS policies.
create table public.portal_activity (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  profile_id  uuid references public.profiles(id) on delete set null,
  client_id   uuid references public.clients(id) on delete cascade,
  kind        text not null check (kind in ('visit','login','action')),
  section     text not null,
  detail      text,
  hour_bucket timestamptz not null generated always as (date_trunc('hour', occurred_at)) stored
);

-- The dedupe: repeat visits inside an hour become ON CONFLICT DO NOTHING.
create unique index portal_activity_dedupe_idx
  on public.portal_activity (profile_id, kind, section, hour_bucket);
create index portal_activity_at_idx on public.portal_activity (occurred_at desc);

alter table public.portal_activity enable row level security;
create policy portal_activity_staff_read on public.portal_activity
  for select using (public.is_rocking_staff());
