-- suppliers.email already existed (0035_suppliers.sql) and serves the exact
-- purpose contact_email was added for in 0055 — redundant column, drop it.
alter table public.suppliers drop column contact_email;
