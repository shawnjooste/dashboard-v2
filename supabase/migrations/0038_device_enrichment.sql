-- Device enrichment from Datto: live status + warranty on the device row
-- (client-safe), plus staff-only network/software/UDF detail in side tables.

-- Client-safe scalars on the device itself.
alter table public.devices
  add column if not exists online           boolean,
  add column if not exists last_seen         timestamptz,
  add column if not exists reboot_required   boolean,
  add column if not exists warranty_date     date,
  add column if not exists software_status   text,
  add column if not exists domain            text,
  add column if not exists bios_version      text;

-- Network adapters (MAC / IP) — STAFF ONLY (internal IPs + MACs).
create table if not exists public.device_nics (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid not null references public.devices(id) on delete cascade,
  label          text,
  mac            text,
  ipv4           text,
  ipv6           text,
  nic_type       text,
  import_run_id  uuid references public.import_runs(id)
);
create index if not exists device_nics_device_idx on public.device_nics (device_id);

-- Installed software inventory — STAFF ONLY.
create table if not exists public.device_software (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid not null references public.devices(id) on delete cascade,
  name           text not null,
  version        text,
  import_run_id  uuid references public.import_runs(id)
);
create index if not exists device_software_device_idx on public.device_software (device_id);

-- Datto user-defined fields (BitLocker, server roles, license key…) — STAFF ONLY.
create table if not exists public.device_udfs (
  id             uuid primary key default gen_random_uuid(),
  device_id      uuid not null references public.devices(id) on delete cascade,
  slot           text not null,
  value          text,
  import_run_id  uuid references public.import_runs(id)
);
create index if not exists device_udfs_device_idx on public.device_udfs (device_id);

-- RLS: these three are rocking_staff only (read + write).
alter table public.device_nics     enable row level security;
alter table public.device_software enable row level security;
alter table public.device_udfs     enable row level security;

create policy device_nics_staff on public.device_nics
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy device_software_staff on public.device_software
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy device_udfs_staff on public.device_udfs
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
