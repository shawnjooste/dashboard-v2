-- Audit trail for staff "Sign in as" impersonation. Writes happen only via the
-- service client (no insert/update policies). No cascade on the FKs: an audit
-- row must never vanish silently with a profile.
create table public.impersonation_log (
  id                uuid primary key default gen_random_uuid(),
  staff_profile_id  uuid not null references public.profiles(id),
  target_profile_id uuid not null references public.profiles(id),
  target_email      text not null,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz
);
create index impersonation_log_staff_idx on public.impersonation_log (staff_profile_id, started_at desc);

alter table public.impersonation_log enable row level security;

create policy impersonation_log_staff_read on public.impersonation_log
  for select using (public.is_rocking_staff());
