-- Per-user feature access: role gives defaults, feature_overrides subtracts
-- (e.g. {"billing": false} on a manager). App-side logic lives in
-- lib/feature-access.ts; has_feature() below is its SQL mirror — keep in sync.
-- v1 enforces the money sections (billing, quotes) at the database; other
-- sections are nav/page-gated only.
alter table public.profiles add column feature_overrides jsonb;

-- Does the CALLER have this feature? Staff always; managers unless overridden
-- false; members never (v1 defaults — members have no gateable sections).
create or replace function public.has_feature(p_feature text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.is_rocking_staff() then true
    when public.current_user_role() = 'client_manager' then
      coalesce((select (feature_overrides ->> p_feature)::boolean
                  from public.profiles where id = auth.uid()), true)
    else false
  end;
$$;
grant execute on function public.has_feature(text) to authenticated;

-- Billing: client read now also requires the billing feature. ---------------
drop policy xero_invoices_read on public.xero_invoices;
create policy xero_invoices_read on public.xero_invoices
  for select using (
    public.is_rocking_staff()
    or (client_id = public.current_client_id() and public.has_feature('billing'))
  );
drop policy client_billing_read on public.client_billing;
create policy client_billing_read on public.client_billing
  for select using (
    public.is_rocking_staff()
    or (client_id = public.current_client_id() and public.has_feature('billing'))
  );

-- Quotes: the three manager-read policies (bodies copied verbatim from 0022)
-- each gain the quotes feature requirement. ----------------------------------
drop policy quotes_manager_select on public.quotes;
create policy quotes_manager_select on public.quotes
  for select using (
    public.current_user_role() = 'client_manager'
    and client_id = public.current_client_id()
    and status <> 'draft'
    and public.has_feature('quotes')
  );

drop policy quote_versions_manager_select on public.quote_versions;
create policy quote_versions_manager_select on public.quote_versions
  for select using (
    public.current_user_role() = 'client_manager'
    and exists (
      select 1 from public.quotes q
      where q.id = quote_id
        and q.client_id = public.current_client_id()
        and q.status <> 'draft'
        and q.current_version = quote_versions.version
    )
    and public.has_feature('quotes')
  );

drop policy quote_events_manager_select on public.quote_events;
create policy quote_events_manager_select on public.quote_events
  for select using (
    public.current_user_role() = 'client_manager'
    and exists (
      select 1 from public.quotes q
      where q.id = quote_id
        and q.client_id = public.current_client_id()
        and q.status <> 'draft'
    )
    and public.has_feature('quotes')
  );
