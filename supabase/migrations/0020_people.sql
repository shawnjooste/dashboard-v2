-- Identity layer: a canonical Person per client (golden record), anchored by
-- email. Every product attaches via person_id. Email-native sources (M365,
-- portal logins) wired here; devices in a later slice.

create table public.people (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references public.clients(id) on delete cascade,
  email        text not null,
  display_name text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index people_client_email_idx on public.people (client_id, lower(email));
create index people_client_idx on public.people (client_id);

create trigger people_set_updated_at before update on public.people
  for each row execute function public.set_updated_at();

alter table public.m365_users add column person_id uuid references public.people(id) on delete set null;
alter table public.profiles   add column person_id uuid references public.people(id) on delete set null;

-- Single home for dedup. SECURITY DEFINER so triggers/pulls can call it.
create or replace function public.upsert_person(
  p_client_id uuid, p_email text, p_display_name text, p_is_active boolean default true
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_email text := lower(trim(p_email));
begin
  if v_email = '' or v_email is null then
    raise exception 'a person requires an email anchor';
  end if;
  insert into public.people (client_id, email, display_name, is_active)
  values (p_client_id, v_email, p_display_name, p_is_active)
  on conflict (client_id, lower(email)) do update
    set display_name = coalesce(excluded.display_name, public.people.display_name),
        is_active = excluded.is_active,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.upsert_person(uuid, text, text, boolean) from public, anon;
grant execute on function public.upsert_person(uuid, text, text, boolean) to authenticated;

-- Link a profile to its Person whenever it has a client (matched-domain signup
-- or pending->active approval). Runs BEFORE so it can set NEW.person_id.
create or replace function public.link_profile_person()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.client_id is not null and new.person_id is null then
    new.person_id := public.upsert_person(new.client_id, new.email, null, true);
  end if;
  return new;
end;
$$;

create trigger profiles_link_person before insert or update on public.profiles
  for each row execute function public.link_profile_person();

-- Backfill existing client members (re-fires the BEFORE trigger).
update public.profiles set updated_at = now() where client_id is not null and person_id is null;

-- RLS
alter table public.people enable row level security;
create policy people_select on public.people
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
create policy people_staff_write on public.people
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
