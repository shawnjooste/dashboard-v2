-- Resend's own id for a received email, so the processing step can re-fetch
-- full content (and fresh attachment download links) at process time rather
-- than relying on webhook-time data that may be stale or incomplete.
alter table public.inbound_emails add column resend_email_id text;
