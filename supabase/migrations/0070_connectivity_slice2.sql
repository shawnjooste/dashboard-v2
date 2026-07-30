-- Connectivity slice 2: what the line's settings are, a description, and the
-- live ICMP health written every 5 minutes by scripts/connectivity-pull.mjs
-- running on Vision (LibreNMS is tailnet-only, so the portal cannot poll it).
alter table public.connectivity_services
  add column description     text,
  add column conn_type       text not null default 'dhcp'
                               check (conn_type in ('pppoe','static','dhcp')),
  add column pppoe_username  text,
  -- {ciphertext, iv, tag} base64, AES-256-GCM (CONNECTIVITY_ENC_KEY).
  -- Never selected by client-facing list queries; only the reveal action reads it.
  add column pppoe_secret    jsonb,
  add column ip_address      text,
  add column subnet_mask     text,
  add column gateway         text,
  add column dns_servers     text,
  add column vlan            int,
  add column last_up         boolean,
  add column latency_ms      numeric,
  add column loss_pct        numeric,
  add column last_checked_at timestamptz,
  add column down_since      timestamptz;

-- Rolling ICMP history for the 24h trend. The pull prunes beyond 48h.
create table public.connectivity_samples (
  id         uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.connectivity_services(id) on delete cascade,
  at         timestamptz not null default now(),
  up         boolean,
  latency_ms numeric,
  loss_pct   numeric
);
create index connectivity_samples_service_at_idx on public.connectivity_samples (service_id, at desc);

alter table public.connectivity_samples enable row level security;
create policy connectivity_samples_staff on public.connectivity_samples
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
-- Clients read samples for their own active lines (mirrors the service policy).
create policy connectivity_samples_client_read on public.connectivity_samples
  for select using (
    exists (
      select 1 from public.connectivity_services s
      where s.id = service_id
        and s.client_id = public.current_client_id()
        and s.is_active
    )
  );
