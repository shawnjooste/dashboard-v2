-- Portal Updates are the portal's only non-transactional email (announcements
-- about new features). This is the one switch that turns them off, per person.
-- Everything else the portal sends — quotes, bookings, agreements, job updates,
-- sign-in links — ignores this column entirely and always sends. Enforcement
-- lives in lib/email/send.ts, gated on category = 'portal_update'.
alter table public.profiles
  add column portal_updates_opt_out boolean not null default false;
