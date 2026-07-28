-- Every email the portal sends, so clients can read their own correspondence
-- history at /communications and staff have one source of truth. Written only
-- by the send chokepoint (lib/email/send.ts) and scripts/create-quote.mjs,
-- both service-role — clients never write here.
create table public.sent_emails (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid references public.clients(id) on delete cascade,
  to_emails           text[] not null,
  subject             text not null,
  html                text not null,
  -- Open set (onboarding | booking | quote | job | admin_alert | general):
  -- no check constraint, so a new sender never needs a migration.
  category            text not null default 'general',
  -- 'internal' = addressed to Rocking about a client (signup alerts, staff
  -- job assignments). Never visible to clients — enforced in RLS below.
  audience            text not null default 'client'
                        check (audience in ('client','internal')),
  resend_id           text,
  sent_by_profile_id  uuid references public.profiles(id) on delete set null,
  sent_at             timestamptz not null default now()
);
create index sent_emails_client_at_idx on public.sent_emails (client_id, sent_at desc);
-- Member scoping filters on array containment (to_emails @> ARRAY[...]).
create index sent_emails_to_idx on public.sent_emails using gin (to_emails);

-- The caller's own email, lowercased. SECURITY DEFINER so the lookup isn't
-- itself subject to profiles RLS; mirrors current_client_id()/is_rocking_staff().
create or replace function public.current_user_email()
returns text
language sql stable security definer set search_path = public
as $$
  select lower(email) from public.profiles where id = auth.uid();
$$;
grant execute on function public.current_user_email() to authenticated;

alter table public.sent_emails enable row level security;

create policy sent_emails_staff on public.sent_emails
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Clients read their own client-audience mail: managers see everything sent to
-- their company, members only what was addressed to them. No client write
-- policy of any kind.
create policy sent_emails_client_read on public.sent_emails
  for select using (
    audience = 'client'
    and client_id = public.current_client_id()
    and (
      public.current_user_role() = 'client_manager'
      or public.current_user_email() = any(to_emails)
    )
  );
