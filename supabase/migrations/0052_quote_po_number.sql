-- Optional purchase order number, captured when a client accepts a quote.
alter table public.quotes add column po_number text;
