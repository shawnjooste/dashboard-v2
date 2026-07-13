-- Support packages: the portal-owned tier each client is on. The portal is
-- the gate — FreeScout/Crisp stay dumb channels. Assignment is STAFF-ONLY
-- (clients never set their own tier; managers may not either).
create table public.support_packages (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique check (key in ('free','business_care','partner')),
  name             text not null,
  rank             int  not null default 0,
  included_minutes int  not null default 0,
  sla_hours        int,
  has_chat         boolean not null default false,
  remote_included  boolean not null default false,
  is_default       boolean not null default false
);

insert into public.support_packages (key, name, rank, included_minutes, sla_hours, has_chat, remote_included, is_default) values
  ('free',          'Standard',      0, 0,    null, false, false, true),
  ('business_care', 'Business Care', 1, 300,  8,    false, true,  false),
  ('partner',       'Partner',       2, 600,  4,    true,  true,  false);

alter table public.clients
  add column support_package_id uuid references public.support_packages(id) on delete set null,
  add column support_plan_label text;

-- Portal-owned time ledger (NOT FreeScout's module). Month usage is computed
-- at read time from occurred_on — no reset job.
create table public.support_time_entries (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  minutes           int  not null check (minutes > 0),
  work_type         text not null default 'ticket'
                      check (work_type in ('ticket','remote','onsite','other')),
  note              text,
  freescout_number  int,
  entered_by        uuid references public.profiles(id) on delete set null,
  occurred_on       date not null default current_date,
  created_at        timestamptz not null default now()
);
create index support_time_entries_client_idx on public.support_time_entries (client_id, occurred_on);

alter table public.support_packages enable row level security;
alter table public.support_time_entries enable row level security;

-- Packages are effectively the price list: any signed-in user may read.
create policy support_packages_read on public.support_packages
  for select to authenticated using (true);
create policy support_packages_staff on public.support_packages
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Ledger: staff everything; a client's users may READ their own entries
-- (transparency makes the hours meter trustworthy at invoice time).
create policy support_time_entries_staff on public.support_time_entries
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy support_time_entries_client_read on public.support_time_entries
  for select using (client_id = public.current_client_id());
