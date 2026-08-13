-- Fix: 0089's seed only matched three-letter uppercase prefixes
-- (^QU-[A-Z]{3}-[0-9]{3}$), which silently skipped real, accepted quotes
-- whose prefix doesn't fit that shape — e.g. QU-J2M-001 (digit in prefix)
-- and QU-SECTOR-001 (six letters). Those prefixes have no counter row, so
-- if either is later assigned as a client's quote_prefix, the counter
-- would start at 0 and next_quote_number() would re-mint an already-issued
-- number (blocked by the unique constraint on quotes.quote_number, but it
-- would break quote creation for that client until diagnosed).
--
-- This re-seeds from every quote number of the general shape
-- QU-<prefix>-<digits>, regardless of the prefix's length or character
-- set. Idempotent and non-lowering, same as 0089: on conflict it only
-- raises last_n, never drops it.
--
-- Deliberately does NOT touch clients.quote_prefix for J2M or SECTOR (or
-- any other newly-seeded prefix) — assigning a client's prefix is a
-- business decision, not something to infer here. Leaving it null is the
-- safe state: the quote service refuses to create a quote for a client
-- with no prefix.

insert into public.quote_prefix_counters (prefix, last_n)
select prefix, max(last_n) as last_n
  from (
    select (regexp_match(quote_number, '^QU-(.+)-([0-9]+)$'))[1] as prefix,
           (regexp_match(quote_number, '^QU-(.+)-([0-9]+)$'))[2]::int as last_n
      from public.quotes
     where quote_number ~ '^QU-.+-[0-9]+$'
  ) s
 group by 1
on conflict (prefix) do update set last_n = greatest(quote_prefix_counters.last_n, excluded.last_n);
