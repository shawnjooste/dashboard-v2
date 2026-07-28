-- Quotes the automated inbound-email pipeline builds land in
-- 'pending_review' instead of going straight to 'sent' — Shawn/Kelle get
-- notified and approve-and-send from the admin quote page. Quotes created
-- interactively (via chat, already reviewed before Claude hits send) are
-- unaffected and continue to go straight to 'sent'.
alter table public.quotes drop constraint quotes_status_check;
alter table public.quotes add constraint quotes_status_check
  check (status in ('draft', 'pending_review', 'sent', 'accepted', 'rejected', 'changes_requested'));

alter table public.quote_events drop constraint quote_events_event_check;
alter table public.quote_events add constraint quote_events_event_check
  check (event in ('created', 'pending_review', 'sent', 'viewed', 'accepted', 'rejected', 'changes_requested'));
