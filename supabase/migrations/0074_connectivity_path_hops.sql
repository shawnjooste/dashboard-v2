-- The path a client's connectivity actually takes: an ordered chain of hops
-- (internet → core → distribution → their device) shown as a diagram on the
-- Connectivity page. Hops are curated by staff, not discovered by traceroute —
-- a client-facing picture should tell the story we mean, not list anonymous
-- routers. A hop mapped to a LibreNMS device gets its own live status from the
-- same 5-minute pull that polls the lines.
create table public.connectivity_path_hops (
  id                 uuid primary key default gen_random_uuid(),
  service_id         uuid not null references public.connectivity_services(id) on delete cascade,
  position           int  not null default 0,
  label              text not null,
  kind               text not null default 'other'
                       check (kind in ('internet','core','distribution','wireless','tower','cpe','site','other')),
  librenms_device_id int,
  last_up            boolean,
  latency_ms         numeric,
  last_checked_at    timestamptz,
  created_at         timestamptz not null default now()
);
create index connectivity_path_hops_service_idx on public.connectivity_path_hops (service_id, position);

alter table public.connectivity_path_hops enable row level security;
create policy connectivity_path_hops_staff on public.connectivity_path_hops
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
-- Clients see the path of their own active lines (mirrors the service policy).
create policy connectivity_path_hops_client_read on public.connectivity_path_hops
  for select using (
    exists (
      select 1 from public.connectivity_services s
      where s.id = service_id
        and s.client_id = public.current_client_id()
        and s.is_active
    )
  );
