-- Client users may read their OWN client's domain rows (needed for the
-- manager-side support filter; harmless for members). Staff-only write
-- policy from 0008 is unchanged. Anticipated by Plan 2 carry-forward note.
create policy client_domains_own_client_read on public.client_domains
  for select using (client_id = public.current_client_id());
