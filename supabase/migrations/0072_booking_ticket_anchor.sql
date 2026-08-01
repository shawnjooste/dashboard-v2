-- The ticket a session belongs to. Set when the booking is created, so the
-- confirmation notes that conversation instead of creating a duplicate.
-- freescout_number keeps its meaning (the ticket we posted to); for new
-- bookings the two match, and older rows keep working via the fallback path.
alter table public.support_bookings
  add column ticket_number int;
