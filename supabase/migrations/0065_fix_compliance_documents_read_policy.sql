-- 0063 created compliance_documents_read as `for select using (true)`, with no
-- role restriction. Supabase grants anon access to new public-schema tables by
-- default, so that policy was satisfied for unauthenticated requests — verified
-- by reading a row with only the public anon key. The documents are meant to be
-- shared with every signed-in client, not with the internet. Recreate the policy
-- scoped to `authenticated`, matching the convention in 0044/0045/0050.
drop policy if exists compliance_documents_read on public.compliance_documents;

create policy compliance_documents_read on public.compliance_documents
  for select to authenticated using (true);
