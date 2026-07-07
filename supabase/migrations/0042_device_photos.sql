-- Photos of a device's physical state (cracked hinge, swollen battery, general
-- condition). Staff upload/delete; clients view photos of devices they can see.
create table public.device_photos (
  id                     uuid primary key default gen_random_uuid(),
  device_id              uuid not null references public.devices(id) on delete cascade,
  storage_path           text not null,
  caption                text,
  file_size              integer,
  mime_type              text,
  uploaded_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index device_photos_device_idx on public.device_photos (device_id);

alter table public.device_photos enable row level security;

create policy device_photos_staff on public.device_photos
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Clients: read-only on photos of devices they can already see. The subquery
-- runs under the caller's own devices RLS, so photo visibility exactly mirrors
-- device visibility (manager: their client's fleet; member: assigned machines).
-- devices' policies don't reference device_photos, so no RLS recursion.
create policy device_photos_client_read on public.device_photos
  for select using (device_id in (select id from public.devices));

-- Private storage bucket for the images (server-side access only). -----------
insert into storage.buckets (id, name, public)
values ('device-photos', 'device-photos', false)
on conflict (id) do nothing;
