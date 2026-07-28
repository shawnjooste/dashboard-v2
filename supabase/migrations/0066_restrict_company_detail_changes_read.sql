-- 0063 gated client_company_details on current_user_role() = 'client_manager'
-- but left the audit-trail read policy open to any role in the client. A
-- client_member could therefore read every old/new value — VAT number,
-- registration number, addresses, billing contact — reconstructing the
-- manager-only record the details table denies them. Align the two.
drop policy if exists company_detail_changes_client_read on public.company_detail_changes;

create policy company_detail_changes_client_read on public.company_detail_changes
  for select using (
    client_id = public.current_client_id()
    and public.current_user_role() = 'client_manager'
  );
