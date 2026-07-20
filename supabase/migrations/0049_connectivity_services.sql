-- Connectivity services: the internet lines Rocking provides per client.
-- The PORTAL is the source of record (no upstream system) — staff enter and
-- maintain these. librenms_device_id links a line to live monitoring.
create table public.connectivity_services (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  label              text not null,
  kind               text not null default 'fibre' check (kind in ('fibre','wireless','lte','other')),
  provider           text,
  download_mbps      int,
  upload_mbps        int,
  librenms_device_id int,
  notes              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index connectivity_services_client_idx on public.connectivity_services (client_id);

alter table public.connectivity_services enable row level security;
create policy connectivity_services_staff on public.connectivity_services
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
-- Clients read their own ACTIVE lines (members included — page access is
-- feature-gated separately; retired lines are staff-only history).
create policy connectivity_services_client_read on public.connectivity_services
  for select using (client_id = public.current_client_id() and is_active);
