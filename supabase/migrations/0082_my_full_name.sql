-- The caller's full name, for the live-chat identity. Sibling of
-- my_first_name() (0031) and SECURITY DEFINER for the same reason: a person
-- row stranded under a different client is hidden by RLS, and the chat should
-- still know who it's talking to.
--
-- Why it exists at all: Crisp was falling back to the email local part, so
-- three different Moniques all showed up as "monique".
--
-- Falls back to display_name when the name parts are empty, and returns null
-- when there is nothing worth showing — the caller then pushes no nickname
-- rather than pushing a blank one.

create or replace function public.my_full_name()
returns text
language sql stable security definer set search_path = public
as $$
  select coalesce(
           nullif(trim(concat_ws(' ', pe.first_name, pe.last_name)), ''),
           nullif(trim(pe.display_name), '')
         )
    from public.profiles pr
    join public.people pe on pe.id = pr.person_id
   where pr.id = auth.uid();
$$;

revoke all on function public.my_full_name() from public, anon;
grant execute on function public.my_full_name() to authenticated;
