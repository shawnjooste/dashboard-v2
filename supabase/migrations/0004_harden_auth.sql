-- Code-review hardening for the tenancy/auth layer.

-- 1) Rename current_role() -> current_user_role() to avoid shadowing the
--    Postgres built-in `current_role` keyword in RLS policies.
alter function public.current_role() rename to current_user_role;

-- 2) Make the new-user trigger idempotent so a profile-insert conflict can
--    never abort an auth.users insert (which would break signup).
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
  values (new.id, new.email, v_client_id, v_role, v_status)
  on conflict (id) do nothing;

  return new;
end;
$$;

-- 3) Keep profiles.updated_at fresh on every update.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();
