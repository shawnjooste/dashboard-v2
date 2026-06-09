-- Helper functions used by RLS. SECURITY DEFINER so they read profiles
-- without being blocked by profiles' own RLS, avoiding recursive policies.

create or replace function public.current_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_client_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select client_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_rocking_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select role = 'rocking_staff' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- New-user resolver: runs on every auth.users insert. Decides client + role
-- + status from the email domain. Robust to whichever auth entry path is used.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_domain      text := lower(split_part(new.email, '@', 2));
  v_client_id   uuid;
  v_role        public.user_role := 'client_member';
  v_status      public.profile_status := 'pending';
begin
  if v_domain = 'rocking.one' then
    v_role := 'rocking_staff';
    v_status := 'active';
    v_client_id := null;
  else
    select client_id into v_client_id
      from public.client_domains where lower(domain) = v_domain
      limit 1;
    if v_client_id is not null then
      v_role := 'client_member';
      v_status := 'active';
    else
      v_status := 'pending';  -- unknown domain: authenticated but unassigned
    end if;
  end if;

  insert into public.profiles (id, email, client_id, role, status)
  values (new.id, new.email, v_client_id, v_role, v_status);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
