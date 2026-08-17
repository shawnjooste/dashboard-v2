-- One 'sent' quote_events row per (quote_id, version). Verified 0 duplicates
-- among the 50 existing 'sent' events immediately before this migration was
-- written (see .superpowers/sdd/2026-08-13-quote-service-layer/final-fix-report.md).
--
-- This also makes lib/quotes/service.ts's send() retry-recovery path safe: a
-- crashed first-send that flipped quotes.status to 'sent' but died before the
-- 'sent' event insert leaves a quote with no event row at all. The retry
-- branch recovers by inserting that missing row with a fresh claim token; if
-- two callers race to recover the same quote/version, this index guarantees
-- only one insert wins and the loser gets a clean unique-violation to report
-- as "already being sent" instead of silently duplicating the row.
create unique index quote_events_one_sent_per_version
  on public.quote_events (quote_id, version)
  where event = 'sent';
