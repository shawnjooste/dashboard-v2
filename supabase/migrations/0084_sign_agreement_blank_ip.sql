-- The generated client types declare sign_agreement's text params as non-null,
-- so the caller passes '' when it cannot determine the IP or user agent.
-- Normalise blanks to NULL here rather than storing an empty string that reads
-- like a captured value in the signature record.

create or replace function public.sign_agreement(
  p_agreement_id uuid,
  p_signer_name  text,
  p_ip           text,
  p_user_agent   text
) returns public.agreements
language plpgsql security definer set search_path = public as $$
declare
  v_row public.agreements;
  v_email text;
begin
  if coalesce(trim(p_signer_name), '') = '' then
    raise exception 'a signature needs your full name';
  end if;

  select email into v_email from public.profiles where id = auth.uid();

  update public.agreements a
     set status               = 'signed',
         signed_at            = now(),
         signed_by_profile_id = auth.uid(),
         signer_name          = trim(p_signer_name),
         signer_email         = v_email,
         signer_ip            = nullif(trim(coalesce(p_ip, '')), ''),
         signer_user_agent    = nullif(left(trim(coalesce(p_user_agent, '')), 400), '')
   where a.id = p_agreement_id
     and a.status = 'sent'
     and a.client_id = public.current_client_id()
     and public.current_user_role() = 'client_manager'
     and public.has_feature('agreements')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'this agreement is not available for you to sign';
  end if;
  return v_row;
end $$;

grant execute on function public.sign_agreement(uuid, text, text, text) to authenticated;
