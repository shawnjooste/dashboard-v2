-- Add the 'rejected' status so staff can decline a pending signup. Must be its
-- own migration: Postgres forbids using a newly-added enum value in the same
-- transaction that adds it, so the RPCs that use it live in 0028.
alter type public.profile_status add value if not exists 'rejected';
