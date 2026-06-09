-- Keep updated_at fresh on the two current-state Datto tables, matching the
-- precedent set for profiles in 0004. Reuses public.set_updated_at().
create trigger devices_set_updated_at
  before update on public.devices
  for each row execute function public.set_updated_at();

create trigger device_patch_status_set_updated_at
  before update on public.device_patch_status
  for each row execute function public.set_updated_at();
