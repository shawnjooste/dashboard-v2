-- RFQs — admin request-for-quote tracker. An RFQ is a card (optional client or
-- free-text prospect, who requested it, description, status, optional linked
-- quote) with an activity log. Staff-only throughout; clients never see these.

create table public.rfqs (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  client_id        uuid references public.clients(id) on delete set null,
  client_name      text,                       -- free-text client/prospect when no client_id
  requested_by     text,                       -- who asked (a customer contact or a team member)
  description      text,
  status           text not null default 'new'
                     check (status in ('new','sourcing','quoted','won','lost')),
  needed_by        date,
  sourcing_note    text,                        -- shown as the card tag while status = 'sourcing'
  notes            text,                        -- internal
  quote_id         uuid references public.quotes(id) on delete set null,
  lost_reason      text,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz
);
create index rfqs_status_idx on public.rfqs (status);
create index rfqs_client_idx on public.rfqs (client_id);

-- Activity log: 'created' / 'status' (stage change) / 'quote_linked' / 'note'.
create table public.rfq_events (
  id                   uuid primary key default gen_random_uuid(),
  rfq_id               uuid not null references public.rfqs(id) on delete cascade,
  kind                 text not null check (kind in ('created','status','quote_linked','note')),
  body                 text,
  posted_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now()
);
create index rfq_events_rfq_idx on public.rfq_events (rfq_id);

-- RLS: rocking_staff only (read + write). -----------------------------------
alter table public.rfqs       enable row level security;
alter table public.rfq_events enable row level security;

create policy rfqs_staff on public.rfqs
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy rfq_events_staff on public.rfq_events
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
