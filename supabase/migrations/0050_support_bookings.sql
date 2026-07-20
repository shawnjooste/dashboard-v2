-- Paid support bookings (phase 2 of the support gate). Prices are data;
-- a booking is confirmed ONLY by a verified Paystack payment (webhook or
-- server-side verify) — never by the browser redirect.
create table public.support_services (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key in ('remote','onsite')),
  name        text not null,
  price_cents int  not null check (price_cents > 0),
  active      boolean not null default true
);

insert into public.support_services (key, name, price_cents) values
  ('remote', 'Remote support session', 100000),
  ('onsite', 'Onsite callout',         125000);

create table public.support_bookings (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  service_id         uuid not null references public.support_services(id),
  slot_start         timestamptz not null,
  slot_end           timestamptz not null,
  amount_cents       int not null,
  vat_cents          int not null,
  paystack_reference text not null unique,
  status             text not null default 'pending_payment'
                       check (status in ('pending_payment','paid','completed','cancelled')),
  booked_by          uuid references public.profiles(id) on delete set null,
  freescout_number   int,
  note               text,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);
create index support_bookings_slot_idx on public.support_bookings (slot_start);
create index support_bookings_client_idx on public.support_bookings (client_id);

alter table public.support_services enable row level security;
alter table public.support_bookings enable row level security;

create policy support_services_read on public.support_services
  for select to authenticated using (true);
create policy support_services_staff on public.support_services
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Clients: see and create their own; NO update/delete (status transitions
-- happen server-side via the service client after payment verification).
create policy support_bookings_staff on public.support_bookings
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy support_bookings_client_read on public.support_bookings
  for select using (client_id = public.current_client_id());
create policy support_bookings_client_insert on public.support_bookings
  for insert with check (client_id = public.current_client_id() and status = 'pending_payment');
