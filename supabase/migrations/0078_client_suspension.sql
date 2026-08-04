-- Service suspension is a NOTICE, not a gate: the portal stays fully open
-- (they must be able to see billing and reach support), and these columns
-- only drive the banner telling them what's paused and what to do.
--
-- Deliberately NOT clients.status='inactive' — that means ARCHIVED, and the
-- admin dashboard counts clients as status <> 'inactive', so overloading it
-- would hide a suspended client from staff exactly when they're being chased.
alter table public.clients
  add column suspended_at    timestamptz,
  add column suspension_note text;

comment on column public.clients.suspended_at is
  'Non-null = services suspended; drives the portal banner. Not a gate.';
