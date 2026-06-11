-- Quotes (slice 1). One JSONB document per immutable version; supplier costs
-- in a staff-only table (the privacy boundary is RLS, not convention);
-- append-only audit events. Spec: docs/superpowers/specs/2026-06-11-quotes-design.md

-- ---------- numbering ----------
create table public.quote_counters (
  year int primary key,
  last_n int not null default 0
);
alter table public.quote_counters enable row level security;
-- no policies: only the security-definer function below (and service role) touch it

create or replace function public.next_quote_number()
returns text
language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from now())::int;
  n int;
begin
  insert into quote_counters (year, last_n) values (y, 1)
  on conflict (year) do update set last_n = quote_counters.last_n + 1
  returning last_n into n;
  return 'Q-' || y || '-' || lpad(n::text, 3, '0');
end $$;

revoke execute on function public.next_quote_number() from public, anon, authenticated;

-- ---------- tables ----------
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  quote_number text not null unique,
  title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'changes_requested')),
  current_version int not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index quotes_client_idx on public.quotes (client_id, created_at desc);
create trigger quotes_updated_at before update on public.quotes
  for each row execute function public.set_updated_at();

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  version int not null,
  doc jsonb not null,
  subtotal numeric,
  vat_amount numeric,
  grand_total numeric,
  monthly_total numeric,
  valid_until date,
  created_at timestamptz not null default now(),
  unique (quote_id, version)
);

create table public.quote_internal (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.quote_versions(id) on delete cascade,
  line_path text not null,
  supplier_cost numeric,
  note text
);
create index quote_internal_version_idx on public.quote_internal (version_id);

create table public.quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  version int,
  event text not null
    check (event in ('created', 'sent', 'viewed', 'accepted', 'rejected', 'changes_requested')),
  actor_profile_id uuid references public.profiles(id) on delete set null,
  comment text,
  created_at timestamptz not null default now()
);
create index quote_events_quote_idx on public.quote_events (quote_id, created_at);

-- ---------- RLS ----------
alter table public.quotes enable row level security;
alter table public.quote_versions enable row level security;
alter table public.quote_internal enable row level security;
alter table public.quote_events enable row level security;

create policy quotes_staff_all on public.quotes
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy quotes_manager_select on public.quotes
  for select using (
    public.current_user_role() = 'client_manager'
    and client_id = public.current_client_id()
    and status <> 'draft'
  );

create policy quote_versions_staff_all on public.quote_versions
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
-- managers see only the CURRENT version of visible quotes (latest-only rule)
create policy quote_versions_manager_select on public.quote_versions
  for select using (
    public.current_user_role() = 'client_manager'
    and exists (
      select 1 from public.quotes q
      where q.id = quote_id
        and q.client_id = public.current_client_id()
        and q.status <> 'draft'
        and q.current_version = quote_versions.version
    )
  );

-- supplier costs: staff only, full stop
create policy quote_internal_staff_all on public.quote_internal
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

create policy quote_events_staff_all on public.quote_events
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy quote_events_manager_select on public.quote_events
  for select using (
    public.current_user_role() = 'client_manager'
    and exists (
      select 1 from public.quotes q
      where q.id = quote_id
        and q.client_id = public.current_client_id()
        and q.status <> 'draft'
    )
  );
