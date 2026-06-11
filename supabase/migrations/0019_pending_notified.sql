-- One-time "new signup pending approval" notification guard: stamped when the
-- email to staff has been sent, so repeat logins don't re-notify.
alter table public.profiles add column pending_notified_at timestamptz;
