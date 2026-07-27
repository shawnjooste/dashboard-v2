-- When the pipeline can't resolve a supplier from an instruction or history,
-- it asks Shawn by email with the pending RFQ's tracking token in the
-- subject — his reply needs its own classification so it's recognized as an
-- answer to that specific question, not a fresh client forward.
alter table public.inbound_emails drop constraint inbound_emails_kind_check;
alter table public.inbound_emails add constraint inbound_emails_kind_check
  check (kind in ('client_forward','supplier_reply','client_quote_reply','supplier_clarification','unclassified'));
