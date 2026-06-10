-- Microsoft 365 ingestion. Mirrors the Datto pattern: per-client current-state
-- tables + dated snapshots, source='m365' in import_runs. Tokens are encrypted
-- (AES-256-GCM) by the CLI; this schema only stores ciphertext.

-- Per-client connection (encrypted refresh token). Staff-only.
create table public.m365_connections (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null unique references public.clients(id) on delete cascade,
  tenant_id        text,
  tenant_name      text,
  token_ciphertext text not null,
  token_iv         text not null,
  token_tag        text not null,
  status           text not null default 'connected',
  last_pull_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Current state: one row per Graph user per client.
create table public.m365_users (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  m365_user_id        text not null,
  display_name        text,
  user_principal_name text,
  account_enabled     boolean,
  is_licensed         boolean not null default false,
  assigned_licenses   text[] not null default '{}',
  mfa_methods         text[] not null default '{}',
  mfa_strong          boolean not null default false,
  last_import_run_id  uuid references public.import_runs(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (client_id, m365_user_id)
);
create index m365_users_client_idx on public.m365_users (client_id);

-- Per-client SKU inventory (raw part numbers; friendly names derived on read).
create table public.m365_licenses (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  sku_part_number    text not null,
  total              int,
  consumed           int,
  last_import_run_id uuid references public.import_runs(id),
  unique (client_id, sku_part_number)
);
create index m365_licenses_client_idx on public.m365_licenses (client_id);

-- Per-client security posture (one row per client).
create table public.m365_tenant (
  client_id            uuid primary key references public.clients(id) on delete cascade,
  security_defaults_on boolean,
  ca_policy_count      int,
  secure_score         numeric,
  secure_score_max     numeric,
  licensed_user_count  int,
  mfa_strong_count     int,
  last_import_run_id   uuid references public.import_runs(id),
  updated_at           timestamptz not null default now()
);

-- Dated rollup for trends.
create table public.m365_snapshots (
  id                   uuid primary key default gen_random_uuid(),
  client_id            uuid not null references public.clients(id) on delete cascade,
  snapshot_date        date not null,
  licensed_users       int,
  mfa_coverage_pct     numeric,
  security_defaults_on boolean,
  password_only_count  int,
  import_run_id        uuid references public.import_runs(id),
  unique (client_id, snapshot_date)
);
create index m365_snapshots_client_date_idx on public.m365_snapshots (client_id, snapshot_date);

-- updated_at triggers
create trigger m365_connections_set_updated_at before update on public.m365_connections
  for each row execute function public.set_updated_at();
create trigger m365_users_set_updated_at before update on public.m365_users
  for each row execute function public.set_updated_at();
create trigger m365_tenant_set_updated_at before update on public.m365_tenant
  for each row execute function public.set_updated_at();

-- RLS
alter table public.m365_connections enable row level security;
alter table public.m365_users       enable row level security;
alter table public.m365_licenses    enable row level security;
alter table public.m365_tenant       enable row level security;
alter table public.m365_snapshots    enable row level security;

-- connections: staff only (writes go through the service client regardless).
create policy m365_connections_staff on public.m365_connections
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- data tables: staff all / client users read their own client's rows.
create policy m365_users_select on public.m365_users
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
create policy m365_licenses_select on public.m365_licenses
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
create policy m365_tenant_select on public.m365_tenant
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
create policy m365_snapshots_select on public.m365_snapshots
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
