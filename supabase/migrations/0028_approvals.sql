-- Approvals: reject support + optional domain auto-join on approve.

alter table public.profiles add column decline_reason text;

-- Approve now optionally links the user's email domain to the client, so future
-- signups from that domain skip the queue. Replaces the 3-arg version.
drop function if exists public.approve_pending_user(uuid, uuid, boolean);
create or replace function public.approve_pending_user(
  p_profile_id  uuid,
  p_client_id   uuid,
  p_make_manager boolean default false,
  p_link_domain boolean default false
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
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
     and role <> 'rocking_staff'
   returning email into v_email;

  if not found then
    raise exception 'profile not found or not eligible';
  end if;

  if p_link_domain and v_email is not null then
    insert into public.client_domains (domain, client_id)
    values (lower(split_part(v_email, '@', 2)), p_client_id)
    on conflict (domain) do nothing;
  end if;
end;
$$;

revoke all on function public.approve_pending_user(uuid, uuid, boolean, boolean) from public, anon;
grant execute on function public.approve_pending_user(uuid, uuid, boolean, boolean) to authenticated;

-- Staff-only: decline a pending signup. Blocks access (they keep an auditable
-- 'rejected' row) rather than deleting them.
create or replace function public.reject_pending_user(p_profile_id uuid, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_rocking_staff() then
    raise exception 'only rocking staff may reject users';
  end if;
  update public.profiles
     set status = 'rejected', decline_reason = p_reason
   where id = p_profile_id
     and status = 'pending'
     and role <> 'rocking_staff';
  if not found then
    raise exception 'no pending user to reject';
  end if;
end;
$$;

revoke all on function public.reject_pending_user(uuid, text) from public, anon;
grant execute on function public.reject_pending_user(uuid, text) to authenticated;
