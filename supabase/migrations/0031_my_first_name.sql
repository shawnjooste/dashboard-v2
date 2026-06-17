-- Read the caller's own first name, independent of RLS.
-- The first-login name gate previously read people.first_name through the
-- authenticated (RLS) client. If a user's linked person row sits under a
-- different client_id than their profile (e.g. moved between clients), the
-- people RLS policy (client_id = current_client_id()) hides their own row, the
-- gate sees no name, and it loops /welcome forever. SECURITY DEFINER here reads
-- only the caller's own linked person, so the gate can never be RLS-starved.
create or replace function public.my_first_name()
returns text
language sql security definer set search_path = public
as $$
  select pe.first_name
    from public.profiles pr
    join public.people pe on pe.id = pr.person_id
   where pr.id = auth.uid();
$$;

revoke all on function public.my_first_name() from public, anon;
grant execute on function public.my_first_name() to authenticated;
