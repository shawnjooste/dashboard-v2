-- Staff-only: assign a pending user to a client and activate them atomically.
-- Enforces that only rocking_staff may call it, and that the target client exists.
create or replace function public.approve_pending_user(
  p_profile_id uuid,
  p_client_id  uuid,
  p_make_manager boolean default false
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_rocking_staff() then
    raise exception 'only rocking staff may approve users';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'client does not exist';
  end if;

  update public.profiles
     set client_id = p_client_id,
         status    = 'active',
         role      = case when p_make_manager then 'client_manager'::public.user_role
                          else role end
   where id = p_profile_id;

  if not found then
    raise exception 'profile not found';
  end if;
end;
$$;

revoke all on function public.approve_pending_user(uuid, uuid, boolean) from public, anon;
grant execute on function public.approve_pending_user(uuid, uuid, boolean) to authenticated;
