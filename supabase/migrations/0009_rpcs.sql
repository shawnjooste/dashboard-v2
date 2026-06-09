-- Lists devices in the caller's client that are not yet claimed by anyone.
-- Used in the onboarding "claim your machine" step.
create or replace function public.claimable_devices()
returns table (id uuid, hostname text, assigned_user_label text)
language sql stable security definer set search_path = public
as $$
  select d.id, d.hostname, d.assigned_user_label
  from public.devices d
  where d.client_id = public.current_client_id()
    and public.current_client_id() is not null
    and not exists (
      select 1 from public.device_assignments a where a.device_id = d.id
    );
$$;

-- Claims a device for the calling user. Only permits devices in the caller's
-- own client. Idempotent (re-claiming the same device is a no-op).
create or replace function public.claim_device(p_device_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_client uuid := public.current_client_id();
begin
  if v_client is null then
    raise exception 'caller has no client';
  end if;
  if not exists (
    select 1 from public.devices d
    where d.id = p_device_id and d.client_id = v_client
  ) then
    raise exception 'device not in caller client';
  end if;
  insert into public.device_assignments (device_id, profile_id)
  values (p_device_id, auth.uid())
  on conflict (device_id, profile_id) do nothing;
end;
$$;

revoke all on function public.claimable_devices() from public;
revoke all on function public.claim_device(uuid) from public;
grant execute on function public.claimable_devices() to authenticated;
grant execute on function public.claim_device(uuid) to authenticated;
