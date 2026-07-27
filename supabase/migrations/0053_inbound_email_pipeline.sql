-- Inbound email pipeline: quotes@send.rocking.one receives client-request
-- forwards, supplier pricing replies, and client replies to sent quotes.
-- A webhook stores + coarsely classifies each message; a scheduled agent does
-- the actual reading/drafting/sending.

-- RFQs get a short token embedded in the subject of our outbound "asking a
-- supplier for pricing" email, so their reply can be matched back reliably —
-- and a record of which supplier we asked.
alter table public.rfqs add column tracking_token text;
create unique index rfqs_tracking_token_idx on public.rfqs (tracking_token) where tracking_token is not null;
alter table public.rfqs add column supplier_name text;
alter table public.rfqs add column supplier_email text;

-- New event kinds for the automated relay/reply steps.
alter table public.rfq_events drop constraint rfq_events_kind_check;
alter table public.rfq_events add constraint rfq_events_kind_check
  check (kind in ('created','status','quote_linked','note','email_sent','email_received'));

-- Resend's id for a sent quote email, so a client's reply (In-Reply-To) can be
-- matched back to the quote it was replying about.
alter table public.quote_events add column resend_message_id text;

create table public.inbound_emails (
  id           uuid primary key default gen_random_uuid(),
  message_id   text,
  in_reply_to  text,
  from_email   text not null,
  to_email     text not null,
  subject      text,
  text_body    text,
  html_body    text,
  attachments  jsonb not null default '[]'::jsonb,
  kind         text not null default 'unclassified'
                 check (kind in ('client_forward','supplier_reply','client_quote_reply','unclassified')),
  rfq_id       uuid references public.rfqs(id) on delete set null,
  quote_id     uuid references public.quotes(id) on delete set null,
  processed_at timestamptz,
  created_at   timestamptz not null default now()
);
create index inbound_emails_rfq_idx on public.inbound_emails (rfq_id);
create index inbound_emails_quote_idx on public.inbound_emails (quote_id);
create index inbound_emails_unprocessed_idx on public.inbound_emails (created_at) where processed_at is null;
create unique index inbound_emails_message_id_idx on public.inbound_emails (message_id) where message_id is not null;

alter table public.inbound_emails enable row level security;
create policy inbound_emails_staff on public.inbound_emails
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
