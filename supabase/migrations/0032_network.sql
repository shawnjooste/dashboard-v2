-- Network monitoring (Slice 1) — current-state + dated-snapshot tables for
-- Meraki / UniFi data, mirroring the Datto hybrid-history model. All
-- client-scoped tables carry client_id and are RLS-protected; writes happen
-- through the service-role collector (the ingestion layer), reads are scoped to
-- staff or the owning client.

-- Maps a vendor source-site to a Portal client (the "which client is this"
-- resolver). Staff-maintained. Unknown key ⇒ collector stops and asks.
create table public.network_source_aliases (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                 -- 'meraki' | 'unifi_selfhosted'
  source_key  text not null,                 -- org/network id, or controller site id
  client_id   uuid not null references public.clients(id) on delete cascade,
  label       text,                          -- friendly name (e.g. 'GSRLaw', 'Gunstons')
  created_at  timestamptz not null default now(),
  unique (source, source_key)
);

-- A monitored source-site under a client (Meraki network or UniFi site).
create table public.network_sites (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  source             text not null,
  source_site_id     text not null,
  name               text not null,
  status             text,                   -- 'online' | 'degraded' | 'offline'
  device_count       int,
  client_count       int,
  last_seen_at       timestamptz,
  last_import_run_id uuid references public.import_runs(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (source, source_site_id)
);
create index network_sites_client_idx on public.network_sites (client_id);

-- One row per monitored device; identity is (source, source_device_id) where
-- source_device_id is the serial (Meraki) or MAC (UniFi).
create table public.network_devices (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  site_id            uuid references public.network_sites(id) on delete cascade,
  source             text not null,
  source_device_id   text not null,
  name               text,
  kind               text,                   -- 'gateway' | 'switch' | 'ap' | 'other'
  model              text,
  ip                 text,
  status             text,                   -- 'online' | 'offline' | 'alerting'
  firmware           text,
  uptime_s           bigint,
  client_count       int,
  last_seen_at       timestamptz,
  last_import_run_id uuid references public.import_runs(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (source, source_device_id)
);
create index network_devices_client_idx on public.network_devices (client_id);
create index network_devices_site_idx on public.network_devices (site_id);

-- Dated trend: one row per site per ingestion run. Replaced per (site, date).
create table public.network_health_snapshots (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  site_id       uuid not null references public.network_sites(id) on delete cascade,
  snapshot_date date not null,
  devices_total int,
  devices_up    int,
  devices_down  int,
  client_count  int,
  status        text,
  created_at    timestamptz not null default now(),
  unique (site_id, snapshot_date)
);
create index network_health_snapshots_client_idx on public.network_health_snapshots (client_id);

-- RLS -----------------------------------------------------------------------
alter table public.network_source_aliases    enable row level security;
alter table public.network_sites             enable row level security;
alter table public.network_devices           enable row level security;
alter table public.network_health_snapshots  enable row level security;

-- Aliases: staff-only (the mapping is internal).
create policy network_source_aliases_staff on public.network_source_aliases
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Client-scoped reads: staff see all; anyone in the owning client (manager or
-- member) sees their own network. Writes are service-role only.
create policy network_sites_select on public.network_sites
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
create policy network_devices_select on public.network_devices
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
create policy network_health_snapshots_select on public.network_health_snapshots
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
