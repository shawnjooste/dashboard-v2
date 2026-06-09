-- One row per ingestion run; the audit anchor for every imported row.
create table public.import_runs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                 -- e.g. 'datto'
  report_date date not null,
  file_names  text[] not null default '{}',
  counts      jsonb  not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Maps Datto's freeform "Site" strings to a client. Maintained by the agent.
create table public.site_aliases (
  id         uuid primary key default gen_random_uuid(),
  site_name  text not null unique,
  client_id  uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Devices: current state, one row per physical machine.
-- device_identity is the stable upsert key: serial number when present,
-- otherwise hostname. Set by the ingestion layer, unique within a client.
create table public.devices (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  device_identity    text not null,
  hostname           text not null,
  serial_number      text,
  assigned_user_label text,                  -- Datto "description"
  operating_system   text,
  last_reboot        timestamptz,
  cpu                text,
  physical_cores     int,
  memory             text,
  av_status_raw      text,
  av_ok              boolean,
  manufacturer       text,
  model              text,
  external_ip        text,
  agent_version      text,
  enrollment_date    timestamptz,
  last_import_run_id uuid references public.import_runs(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index devices_identity_idx on public.devices (client_id, device_identity);
create index devices_client_id_idx on public.devices (client_id);

-- Links a device to a profile (the claim/assignment step).
create table public.device_assignments (
  id         uuid primary key default gen_random_uuid(),
  device_id  uuid not null references public.devices(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (device_id, profile_id)
);
create index device_assignments_profile_idx on public.device_assignments (profile_id);
