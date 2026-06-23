-- A supplier document can be metadata-only (the commercial data matters more
-- than always having the file attached). Make the file pointer optional.
alter table public.supplier_documents alter column storage_path drop not null;
