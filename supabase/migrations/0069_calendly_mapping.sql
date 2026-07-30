-- Calendly wiring for paid support bookings. A service mapped to a Calendly
-- event type sources its slots from Calendly (Tim's real calendar) and paid
-- bookings are created there too. Null mapping = internal grid (fallback).
alter table public.support_services
  add column calendly_event_type_uri text;

alter table public.support_bookings
  add column calendly_event_uri text;
