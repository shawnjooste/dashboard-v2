-- MDR sub-project A: the normalized security signal stream. Two kinds:
-- 'activity' (a thing happened; immutable) and 'posture' (a standing
-- weakness; one row, flips resolved when a sync sees it fixed). triage_state
-- is ROCKING's layer (agents later, staff now) — independent of source truth.
-- Written only by the normalizer (service role); staff-only reads. Client
-- visibility is sub-project E's decision — no client policies here.
create table public.security_events (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  kind          text not null check (kind in ('activity','posture')),
  source        text not null,
  category      text not null,
  severity      text not null check (severity in ('info','low','medium','high','critical')),
  entity_type   text,
  entity_id     text,
  entity_label  text,
  title         text not null,
  detail        text,
  context       jsonb,
  occurred_at   timestamptz not null,
  source_ref    text not null,
  resolved      boolean not null default false,
  resolved_at   timestamptz,
  triage_state  text not null default 'new'
                  check (triage_state in ('new','acknowledged','escalated','dismissed')),
  triage_note   text,
  triaged_by    uuid references public.profiles(id) on delete set null,
  triaged_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index security_events_ref_idx on public.security_events (client_id, source_ref);
create index security_events_client_at_idx on public.security_events (client_id, occurred_at desc);
create index security_events_sev_triage_idx on public.security_events (severity, triage_state);

alter table public.security_events enable row level security;
create policy security_events_staff on public.security_events
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
