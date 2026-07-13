-- Products: the shared catalog of services/licences Rocking clients have
-- (e.g. "Microsoft 365 Business Premium"), plus per-client allocations.
-- Inventory only — no pricing here, that lives in Billing via real Xero
-- invoices. Manually maintained, no Xero sync.
create table public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.client_products (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity   int  not null default 1 check (quantity > 0),
  note       text,
  created_at timestamptz not null default now()
);
create index client_products_client_idx on public.client_products (client_id);

alter table public.products enable row level security;
alter table public.client_products enable row level security;

-- Catalog is reference data (like the support-package price list): any
-- signed-in user may read; only staff may write.
create policy products_read on public.products
  for select to authenticated using (true);
create policy products_staff on public.products
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Allocations: staff everything; a client's users may read their own rows.
create policy client_products_staff on public.client_products
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy client_products_client_read on public.client_products
  for select using (client_id = public.current_client_id());
