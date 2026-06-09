-- Harden approve_pending_user: never reassign or demote a rocking_staff account.
-- Matching by id alone allowed approving a staff profile (giving them a client /
-- demoting to client_manager). Restrict the UPDATE to non-staff targets.
-- (Reassigning/reactivating an existing CLIENT user remains allowed — a deliberate
-- admin capability — but staff are now untouchable by this RPC.)
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
   where id = p_profile_id
     and role <> 'rocking_staff';

  if not found then
    raise exception 'profile not found or not eligible';
  end if;
end;
$$;
