-- Fix infinite recursion between devices_select and device_assignments_select.
-- The two policies referenced each other's tables, and since policy subqueries
-- are themselves RLS-filtered, evaluation looped (Postgres error 42P17).
-- Move the cross-table lookups into SECURITY DEFINER helpers (which bypass RLS
-- as the table owner), exactly as the profiles helpers already do.

create or replace function public.my_assigned_device_ids()
returns setof uuid
language sql stable security definer set search_path = public
as $$ select device_id from public.device_assignments where profile_id = auth.uid(); $$;

create or replace function public.device_in_current_client(p_device_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$ select exists(
  select 1 from public.devices d
  where d.id = p_device_id and d.client_id = public.current_client_id()
); $$;

drop policy devices_select on public.devices;
create policy devices_select on public.devices
  for select using (
    public.is_rocking_staff()
    or (public.current_user_role() = 'client_manager' and client_id = public.current_client_id())
    or (public.current_user_role() = 'client_member'
        and id in (select public.my_assigned_device_ids()))
  );

drop policy device_assignments_select on public.device_assignments;
create policy device_assignments_select on public.device_assignments
  for select using (
    public.is_rocking_staff()
    or profile_id = auth.uid()
    or (public.current_user_role() = 'client_manager'
        and public.device_in_current_client(device_id))
  );
