-- Staff-only: change an active client user's portal role (manager <-> member)
-- from the admin Users list. Mirrors approve_pending_user's guards: staff-only,
-- never touches a rocking_staff account, and only the two client roles are
-- assignable. Roles previously could only be set at approval time.
create or replace function public.set_portal_role(
  p_profile_id uuid,
  p_role       public.user_role
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_rocking_staff() then
    raise exception 'only rocking staff may change portal roles';
  end if;
  if p_role not in ('client_manager', 'client_member') then
    raise exception 'role must be client_manager or client_member';
  end if;

  update public.profiles
     set role = p_role
   where id = p_profile_id
     and status = 'active'
     and role <> 'rocking_staff';

  if not found then
    raise exception 'profile not found or not eligible';
  end if;
end;
$$;

revoke all on function public.set_portal_role(uuid, public.user_role) from public, anon;
grant execute on function public.set_portal_role(uuid, public.user_role) to authenticated;
