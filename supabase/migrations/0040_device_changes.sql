-- Manual hardware / maintenance change-log per device. Records work we've done
-- that may not reflect in Datto (e.g. a VM disk resize). Staff-only.
create table public.device_changes (
  id                    uuid primary key default gen_random_uuid(),
  device_id             uuid not null references public.devices(id) on delete cascade,
  category              text not null default 'other'
                          check (category in ('disk','memory','cpu','hardware','software','config','other')),
  note                  text not null,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now()
);
create index device_changes_device_idx on public.device_changes (device_id);

alter table public.device_changes enable row level security;
create policy device_changes_staff on public.device_changes
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
