-- Current drives per device; replaced wholesale on each import.
create table public.device_storage (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.devices(id) on delete cascade,
  drive         text not null,
  drive_type    text,
  size_gb       numeric,
  free_gb       numeric,
  used_gb       numeric,
  free_pct      numeric,
  used_pct      numeric,
  import_run_id uuid references public.import_runs(id)
);
create index device_storage_device_idx on public.device_storage (device_id);

-- Current patch status; one row per device.
create table public.device_patch_status (
  device_id               uuid primary key references public.devices(id) on delete cascade,
  patches_approved_pending int,
  patches_installed        int,
  patches_not_approved     int,
  patch_status             text,
  last_reboot              timestamptz,
  import_run_id            uuid references public.import_runs(id),
  updated_at               timestamptz not null default now()
);

-- Monitor alerts; time-stamped history. Idempotent on (device, triggered_at, message).
create table public.device_alerts (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.devices(id) on delete cascade,
  triggered_at  timestamptz not null,
  message       text not null,
  priority      text,
  resolved      boolean not null default false,
  resolved_at   timestamptz,
  ticket_number text,
  alert_policy  text,
  import_run_id uuid references public.import_runs(id),
  unique (device_id, triggered_at, message)
);
create index device_alerts_device_idx on public.device_alerts (device_id);

-- Dated trend snapshot; one row per device per report date.
create table public.device_health_snapshots (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid not null references public.devices(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  snapshot_date    date not null,
  patch_pct        numeric,
  max_disk_pct     numeric,
  av_ok            boolean,
  open_alert_count int,
  import_run_id    uuid references public.import_runs(id),
  unique (device_id, snapshot_date)
);
create index health_snapshots_client_date_idx
  on public.device_health_snapshots (client_id, snapshot_date);
