-- Company details a client manager can see and correct, plus an append-only
-- audit trail of their edits, plus Rocking's own compliance documents.

-- 1. Company details -------------------------------------------------------
-- Kept out of public.clients deliberately: clients is a 4-column table read on
-- nearly every page (nav, layout, client lists), and widening it would widen
-- all of those queries.
create table public.client_company_details (
  client_id             uuid primary key references public.clients(id) on delete cascade,
  registered_name       text,
  trading_name          text,
  registration_number   text,
  vat_number             text,
  physical_address      text,
  physical_city         text,
  physical_postal_code  text,
  postal_address        text,
  postal_city           text,
  postal_postal_code    text,
  billing_contact_name  text,
  billing_contact_email text,
  billing_contact_phone text,
  po_required           boolean not null default false,
  billing_notes         text,
  updated_at            timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null
);

alter table public.client_company_details enable row level security;

create policy company_details_staff on public.client_company_details
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Managers read and maintain their own client's row. Members get no policy at
-- all, so they cannot see it — Billing is manager-only by design.
create policy company_details_manager_read on public.client_company_details
  for select using (
    client_id = public.current_client_id()
    and public.current_user_role() = 'client_manager'
  );

create policy company_details_manager_insert on public.client_company_details
  for insert with check (
    client_id = public.current_client_id()
    and public.current_user_role() = 'client_manager'
  );

create policy company_details_manager_update on public.client_company_details
  for update using (
    client_id = public.current_client_id()
    and public.current_user_role() = 'client_manager'
  ) with check (
    client_id = public.current_client_id()
    and public.current_user_role() = 'client_manager'
  );

-- 2. Audit trail -----------------------------------------------------------
-- One row per changed field. Deliberately has NO client insert/update/delete
-- policy: rows are written by the server action with the service role, so the
-- party being audited cannot forge or erase entries.
create table public.company_detail_changes (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  field                 text not null,
  old_value             text,
  new_value             text,
  changed_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now()
);
create index company_detail_changes_client_idx
  on public.company_detail_changes (client_id, created_at desc);

alter table public.company_detail_changes enable row level security;

create policy company_detail_changes_staff on public.company_detail_changes
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

create policy company_detail_changes_client_read on public.company_detail_changes
  for select using (client_id = public.current_client_id());

-- 3. Compliance documents --------------------------------------------------
-- Rocking's own paperwork (bank confirmation letter, tax clearance, BEE
-- certificate): uploaded once, readable by every signed-in user. Nothing
-- client-specific belongs in this table.
create table public.compliance_documents (
  id                     uuid primary key default gen_random_uuid(),
  description            text not null,
  storage_path           text not null,
  file_size              integer,
  mime_type              text,
  uploaded_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index compliance_documents_created_idx
  on public.compliance_documents (created_at desc);

alter table public.compliance_documents enable row level security;

create policy compliance_documents_staff on public.compliance_documents
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

create policy compliance_documents_read on public.compliance_documents
  for select using (true);

-- 4. Private storage bucket for the PDFs (server-side signed access only) ---
insert into storage.buckets (id, name, public)
values ('compliance-docs', 'compliance-docs', false)
on conflict (id) do nothing;
