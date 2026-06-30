-- Xero billing: one org connection, per-client Contact mapping, ingested
-- invoices + a per-client summary. Client-facing (RLS), staff manage the link.

-- One encrypted OAuth connection for Rocking's Xero org.
create table public.xero_connection (
  id               int primary key default 1 check (id = 1), -- singleton
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

-- Map a Portal client to its Xero Contact. Null = no Billing tab.
alter table public.clients add column if not exists xero_contact_id text;

-- Ingested invoices + credit notes (AUTHORISED/PAID only).
create table public.xero_invoices (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  xero_invoice_id text not null unique,
  number          text,
  type            text not null check (type in ('invoice','credit_note')),
  status          text not null,
  date            date,
  due_date        date,
  total           numeric(14,2),
  amount_due      numeric(14,2),
  amount_paid     numeric(14,2),
  currency        text,
  import_run_id   uuid references public.import_runs(id),
  updated_at      timestamptz not null default now()
);
create index xero_invoices_client_idx on public.xero_invoices (client_id);

-- Per-client summary for fast page loads.
create table public.client_billing (
  client_id    uuid primary key references public.clients(id) on delete cascade,
  outstanding  numeric(14,2) not null default 0,
  overdue      numeric(14,2) not null default 0,
  currency     text,
  as_of        date,
  updated_at   timestamptz not null default now()
);

alter table public.xero_connection enable row level security;
alter table public.xero_invoices   enable row level security;
alter table public.client_billing  enable row level security;

-- Connection: staff only.
create policy xero_connection_staff on public.xero_connection
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Invoices + summary: a client sees only their own; staff see all.
create policy xero_invoices_read on public.xero_invoices
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
create policy xero_invoices_staff_write on public.xero_invoices
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy client_billing_read on public.client_billing
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
create policy client_billing_staff_write on public.client_billing
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
