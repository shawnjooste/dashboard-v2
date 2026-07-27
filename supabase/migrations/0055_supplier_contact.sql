-- Persistent supplier contact, learned from RFQs as they pass through the
-- inbound email pipeline — once a supplier's email is known, it doesn't need
-- to be given again.
alter table public.suppliers add column contact_email text;
