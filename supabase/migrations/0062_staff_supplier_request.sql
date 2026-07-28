-- Staff (e.g. Kelle from accounts@) email suppliers directly and CC
-- quotes@send.rocking.one for visibility. Those copies were being classified
-- as 'client_forward', which would make the pipeline email the same supplier
-- a second time for pricing the staff member had already requested.
--
-- Distinguish them mechanically: quotes@ in the Cc header (staff running
-- their own thread — observe only) vs quotes@ in To (forwarded to us to
-- action). Store the real header To/Cc so the supplier can be identified and
-- so tokenless replies can be threaded back via In-Reply-To.
alter table public.inbound_emails add column header_to text;
alter table public.inbound_emails add column header_cc text;

alter table public.inbound_emails drop constraint inbound_emails_kind_check;
alter table public.inbound_emails add constraint inbound_emails_kind_check
  check (kind in (
    'client_forward',
    'staff_supplier_request',
    'supplier_reply',
    'client_quote_reply',
    'supplier_clarification',
    'unclassified'
  ));
