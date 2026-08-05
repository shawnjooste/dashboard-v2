-- Status page: staff post incidents (global or client-scoped), update them as
-- things develop, and resolve them. Clients see what affects them plus a
-- permanent history, and can opt into email updates.
-- Spec: docs/superpowers/specs/2026-08-05-status-page-design.md

create table public.status_incidents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  type        text not null check (type in ('outage','degraded','maintenance')),
  status      text not null default 'active' check (status in ('active','resolved')),
  scope       text not null check (scope in ('global','clients')),
  started_at  timestamptz not null default now(),
  resolved_at timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index status_incidents_active_idx on public.status_incidents (status, started_at desc);

-- Targets for scope='clients'. A global incident has no rows here.
create table public.status_incident_clients (
  incident_id uuid not null references public.status_incidents(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  primary key (incident_id, client_id)
);
create index status_incident_clients_client_idx on public.status_incident_clients (client_id);

-- The thread. Creating an incident always writes update #1, so an incident is
-- never a headline with no story. Resolution is an update too.
create table public.status_updates (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references public.status_incidents(id) on delete cascade,
  body          text not null,
  is_resolution boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index status_updates_incident_idx on public.status_updates (incident_id, created_at desc);

-- Per-user opt-in. Row present = subscribed; unsubscribing deletes it.
create table public.status_subscriptions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Can the caller see this incident? Staff: everything. Client: global
-- incidents, plus any incident targeted at their client. SECURITY DEFINER so
-- the membership lookup isn't itself subject to RLS (and can't recurse).
create or replace function public.can_see_incident(p_incident_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.is_rocking_staff()
    or exists (
      select 1 from public.status_incidents i
      where i.id = p_incident_id and i.scope = 'global'
    )
    or exists (
      select 1 from public.status_incident_clients sic
      where sic.incident_id = p_incident_id
        and sic.client_id = public.current_client_id()
    );
$$;
grant execute on function public.can_see_incident(uuid) to authenticated;

alter table public.status_incidents        enable row level security;
alter table public.status_incident_clients enable row level security;
alter table public.status_updates          enable row level security;
alter table public.status_subscriptions    enable row level security;

-- Incidents: everyone reads what they may see; only staff write.
create policy status_incidents_read on public.status_incidents
  for select using (
    public.is_rocking_staff()
    or scope = 'global'
    or exists (
      select 1 from public.status_incident_clients sic
      where sic.incident_id = id and sic.client_id = public.current_client_id()
    )
  );
create policy status_incidents_staff on public.status_incidents
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

create policy status_incident_clients_read on public.status_incident_clients
  for select using (public.can_see_incident(incident_id));
create policy status_incident_clients_staff on public.status_incident_clients
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

create policy status_updates_read on public.status_updates
  for select using (public.can_see_incident(incident_id));
create policy status_updates_staff on public.status_updates
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Subscriptions: a user manages only their own; staff may read all.
create policy status_subscriptions_own on public.status_subscriptions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy status_subscriptions_staff_read on public.status_subscriptions
  for select using (public.is_rocking_staff());
