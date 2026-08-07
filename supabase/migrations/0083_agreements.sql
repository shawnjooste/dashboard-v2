-- Client agreements: staff author markdown, a client manager signs it
-- electronically, and the signed PDF is stored. The portal record is
-- authoritative; the PDF is a copy.

create table public.agreement_counters (
  year    int primary key,
  last_n  int not null
);

create or replace function public.next_agreement_reference()
returns text
language plpgsql security definer set search_path = public as $$
declare
  y int := extract(year from now())::int;
  n int;
begin
  insert into agreement_counters (year, last_n) values (y, 1)
  on conflict (year) do update set last_n = agreement_counters.last_n + 1
  returning last_n into n;
  return 'AGR-' || y || '-' || lpad(n::text, 3, '0');
end $$;
revoke execute on function public.next_agreement_reference() from public, anon, authenticated;

create table public.agreements (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  reference             text not null unique default public.next_agreement_reference(),
  title                 text not null,
  body_md               text not null,
  status                text not null default 'draft'
                          check (status in ('draft','sent','signed','void')),
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  sent_at               timestamptz,
  signed_at             timestamptz,
  signed_by_profile_id  uuid references public.profiles(id) on delete set null,
  signer_name           text,
  signer_email          text,
  signer_ip             text,
  signer_user_agent     text,
  pdf_path              text,
  void_reason           text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index agreements_client_idx on public.agreements (client_id, created_at desc);
create index agreements_status_idx on public.agreements (status);

-- A signed agreement is evidence: its text and signature must never change.
-- The app guards this too; this trigger is what makes it true. pdf_path is
-- deliberately NOT frozen — the PDF is written just after the signature.
create or replace function public.freeze_signed_agreement()
returns trigger language plpgsql as $$
begin
  if old.status = 'signed' then
    if new.body_md is distinct from old.body_md
       or new.title is distinct from old.title
       or new.signed_at is distinct from old.signed_at
       or new.signed_by_profile_id is distinct from old.signed_by_profile_id
       or new.signer_name is distinct from old.signer_name
       or new.signer_email is distinct from old.signer_email
       or new.signer_ip is distinct from old.signer_ip
       or new.signer_user_agent is distinct from old.signer_user_agent
       or new.status is distinct from old.status then
      raise exception 'a signed agreement cannot be altered';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger agreements_freeze before update on public.agreements
  for each row execute function public.freeze_signed_agreement();

alter table public.agreements enable row level security;

create policy agreements_staff on public.agreements
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Managers of that client, sent agreements only, and only if the feature is
-- enabled for them. Members never see agreements. No client write path.
create policy agreements_manager_read on public.agreements
  for select using (
    public.current_user_role() = 'client_manager'
    and client_id = public.current_client_id()
    and status <> 'draft'
    and public.has_feature('agreements')
  );

-- Signing: atomic transition, returns the row only if THIS call did it, so
-- two managers clicking at once cannot both sign.
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
         signer_ip            = p_ip,
         signer_user_agent    = left(coalesce(p_user_agent, ''), 400)
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

-- Private bucket for the generated PDFs (server-side access only).
insert into storage.buckets (id, name, public)
values ('agreement-pdfs', 'agreement-pdfs', false)
on conflict (id) do nothing;
