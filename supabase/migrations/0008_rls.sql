-- Enable RLS everywhere ------------------------------------------------------
alter table public.clients               enable row level security;
alter table public.client_domains        enable row level security;
alter table public.profiles              enable row level security;
alter table public.import_runs           enable row level security;
alter table public.site_aliases          enable row level security;
alter table public.devices               enable row level security;
alter table public.device_assignments    enable row level security;
alter table public.device_storage        enable row level security;
alter table public.device_patch_status   enable row level security;
alter table public.device_alerts         enable row level security;
alter table public.device_health_snapshots enable row level security;

-- profiles -------------------------------------------------------------------
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid() or public.is_rocking_staff());
create policy profiles_manager_select on public.profiles
  for select using (
    public.current_user_role() = 'client_manager'
    and client_id = public.current_client_id()
  );
create policy profiles_staff_write on public.profiles
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- clients --------------------------------------------------------------------
create policy clients_read on public.clients
  for select using (
    public.is_rocking_staff() or id = public.current_client_id()
  );
create policy clients_staff_write on public.clients
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- client_domains / site_aliases / import_runs: staff-only -------------------
create policy client_domains_staff on public.client_domains
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy site_aliases_staff on public.site_aliases
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy import_runs_staff on public.import_runs
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- devices: staff all / manager own-client / member assigned-only ------------
create policy devices_select on public.devices
  for select using (
    public.is_rocking_staff()
    or (public.current_user_role() = 'client_manager' and client_id = public.current_client_id())
    or (public.current_user_role() = 'client_member'
        and id in (select device_id from public.device_assignments
                   where profile_id = auth.uid()))
  );

-- device_assignments: a user sees their own; manager sees their client's ----
create policy device_assignments_select on public.device_assignments
  for select using (
    public.is_rocking_staff()
    or profile_id = auth.uid()
    or (public.current_user_role() = 'client_manager'
        and device_id in (select id from public.devices
                          where client_id = public.current_client_id()))
  );

-- Child tables inherit visibility from their parent device ------------------
create policy device_storage_select on public.device_storage
  for select using (
    device_id in (select id from public.devices)
  );
create policy device_patch_status_select on public.device_patch_status
  for select using (
    device_id in (select id from public.devices)
  );
create policy device_alerts_select on public.device_alerts
  for select using (
    device_id in (select id from public.devices)
  );
create policy device_health_snapshots_select on public.device_health_snapshots
  for select using (
    device_id in (select id from public.devices)
  );
