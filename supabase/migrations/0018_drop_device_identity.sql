-- Identity rewrite complete: every device now carries its Datto uid. Drop the
-- old coalesce(serial,hostname) key and make datto_uid the canonical NOT NULL
-- identity. Datto RMM is the single source of truth for devices.
drop index if exists public.devices_identity_idx;
alter table public.devices drop column device_identity;
alter table public.devices alter column datto_uid set not null;
