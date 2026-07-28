-- The manager-facing RLS policies excluded only 'draft', so the new
-- 'pending_review' status (0059) would have been visible to clients before a
-- human approved it — the whole point of the review gate. Exclude both.
drop policy quotes_manager_select on public.quotes;
create policy quotes_manager_select on public.quotes
  for select using (
    public.current_user_role() = 'client_manager'
    and client_id = public.current_client_id()
    and status not in ('draft', 'pending_review')
  );

drop policy quote_versions_manager_select on public.quote_versions;
create policy quote_versions_manager_select on public.quote_versions
  for select using (
    public.current_user_role() = 'client_manager'
    and exists (
      select 1 from public.quotes q
      where q.id = quote_id
        and q.client_id = public.current_client_id()
        and q.status not in ('draft', 'pending_review')
        and q.current_version = quote_versions.version
    )
  );

drop policy quote_events_manager_select on public.quote_events;
create policy quote_events_manager_select on public.quote_events
  for select using (
    public.current_user_role() = 'client_manager'
    and exists (
      select 1 from public.quotes q
      where q.id = quote_id
        and q.client_id = public.current_client_id()
        and q.status not in ('draft', 'pending_review')
    )
  );
