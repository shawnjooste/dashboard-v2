-- Structured name on the canonical Person, captured at first login. display_name
-- stays the friendly "First Last" used across the UI; first/last let us keep
-- building a richer profile over time.
alter table public.people add column first_name text;
alter table public.people add column last_name text;
