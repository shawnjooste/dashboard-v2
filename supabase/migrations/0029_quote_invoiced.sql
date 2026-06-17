-- Track invoicing on accepted quotes: stamped when staff mark a quote invoiced,
-- so the admin quotes worklist can separate "to invoice" from "invoiced".
alter table public.quotes add column invoiced_at timestamptz;
