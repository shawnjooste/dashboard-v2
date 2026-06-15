-- One-time "user signed in for the first time" notification guard, stamped when
-- the email to staff has been sent so repeat logins don't re-notify. Twin of
-- pending_notified_at.
alter table public.profiles add column first_signin_notified_at timestamptz;

-- A profile only exists because the user has already signed in at least once
-- (it's created on first sign-in). Stamp every existing profile so the rollout
-- doesn't fire a "first sign-in" email for the whole back-catalogue — only
-- users who first sign in AFTER this migration should notify.
update public.profiles set first_signin_notified_at = now();
