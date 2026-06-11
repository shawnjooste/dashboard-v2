-- Device identity rewrite: adopt Datto's stable `uid` as the canonical key.
-- device_identity (the coalesce(serial,hostname) hack) is relaxed here and
-- dropped in 0018 after the first pull backfills datto_uid.
alter table public.devices add column datto_uid text;
create unique index devices_datto_uid_idx on public.devices (datto_uid);
alter table public.devices alter column device_identity drop not null;
