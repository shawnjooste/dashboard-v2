-- Suppliers — admin document library. A supplier (company + contacts) with
-- uploaded documents (their quotes / price lists / spec sheets) carrying
-- commercial metadata. Files live in the private 'supplier-docs' Storage bucket;
-- access is server-side and staff-guarded. Staff-only throughout.

create table public.suppliers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  category     text,
  contact_name text,
  email        text,
  phone        text,
  website      text,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index suppliers_name_idx on public.suppliers (lower(name));

create table public.supplier_documents (
  id                     uuid primary key default gen_random_uuid(),
  supplier_id            uuid not null references public.suppliers(id) on delete cascade,
  title                  text not null,
  doc_type               text not null default 'quote'
                           check (doc_type in ('quote','price_list','spec','invoice','other')),
  reference              text,
  amount                 numeric,
  currency               text not null default 'ZAR',
  doc_date               date,
  valid_until            date,
  notes                  text,
  storage_path           text not null,
  file_name              text,
  file_size              int,
  mime_type              text,
  uploaded_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index supplier_documents_supplier_idx on public.supplier_documents (supplier_id);

-- RLS: rocking_staff only. ---------------------------------------------------
alter table public.suppliers          enable row level security;
alter table public.supplier_documents enable row level security;

create policy suppliers_staff on public.suppliers
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy supplier_documents_staff on public.supplier_documents
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Private storage bucket for the files (server-side access only). ------------
insert into storage.buckets (id, name, public)
values ('supplier-docs', 'supplier-docs', false)
on conflict (id) do nothing;
