-- Single-use Calendly link minted when a quote is sent, so recipients can book
-- a call to discuss it. Calendly hard-caps these at one booking
-- (max_event_count allowed value: 1), so the link belongs to the QUOTE and the
-- first recipient to click consumes it — stored here rather than regenerated,
-- so a re-send reuses the same link instead of splitting bookings across two.
-- Unused Calendly links expire after 90 days; booking_link_created_at lets the
-- send path mint a fresh one rather than send a dead link.
alter table public.quotes add column booking_url text;
alter table public.quotes add column booking_link_created_at timestamptz;
