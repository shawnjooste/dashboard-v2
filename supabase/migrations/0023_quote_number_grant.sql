-- 0022 revoked execute on next_quote_number() from PUBLIC, which also removed
-- the service role's inherited grant. Creation runs via the service role, so
-- grant it back explicitly.
grant execute on function public.next_quote_number() to service_role;
