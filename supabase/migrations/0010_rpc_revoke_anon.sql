-- Least-privilege: the onboarding RPCs have no anon use case. Supabase grants
-- anon EXECUTE directly, so revoke it explicitly (revoke-from-public in 0009
-- does not strip the direct anon grant).
revoke execute on function public.claimable_devices() from anon;
revoke execute on function public.claim_device(uuid)  from anon;
