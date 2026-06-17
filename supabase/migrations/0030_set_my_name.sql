-- Let a signed-in user set their own name without needing the service role.
-- SECURITY DEFINER so it can write the people row (staff-write under RLS), but
-- it only ever touches the caller's own linked person. Used by /welcome so the
-- first-login name step doesn't depend on a service key in the deployed env.
create or replace function public.set_my_name(p_first text, p_last text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_person uuid;
begin
  if coalesce(trim(p_first), '') = '' or coalesce(trim(p_last), '') = '' then
    raise exception 'first and last name are required';
  end if;
  select person_id into v_person from public.profiles where id = auth.uid();
  if v_person is null then
    raise exception 'no linked person to update';
  end if;
  update public.people
     set first_name   = trim(p_first),
         last_name    = trim(p_last),
         display_name = trim(p_first) || ' ' || trim(p_last)
   where id = v_person;
end;
$$;

revoke all on function public.set_my_name(text, text) from public, anon;
grant execute on function public.set_my_name(text, text) to authenticated;
