-- Link outbound mail to an RFQ so the admin RFQ page can show the whole
-- supplier exchange as one thread (our pricing requests from sent_emails,
-- their replies from inbound_emails) instead of just one-line activity notes.
--
-- Supplier correspondence carries our cost prices, so these rows are always
-- audience='internal' — the sent_emails manager policy only exposes
-- audience='client' rows, which keeps supplier pricing away from clients.
alter table public.sent_emails add column rfq_id uuid references public.rfqs(id) on delete set null;
create index sent_emails_rfq_idx on public.sent_emails (rfq_id, sent_at);
