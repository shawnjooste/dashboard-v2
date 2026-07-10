-- Disposition: the first portal-owned device field (not synced from Datto).
-- Marks spares, machines awaiting parts, and devices flagged for removal so
-- the fleet view reflects reality. Editable by Rocking staff AND the client's
-- managers — via the RPC below, never a direct UPDATE (RLS is row-level, so a
-- policy can't stop a manager editing Datto-synced columns).

alter table public.devices
  add column disposition text not null default 'in_use'
    check (disposition in ('in_use','spare','awaiting_repair','to_remove')),
  add column disposition_note text,
  add column disposition_updated_at timestamptz,
  add column disposition_updated_by uuid references public.profiles(id) on delete set null;

create or replace function public.set_device_disposition(
  p_device_id uuid,
  p_disposition text,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_client uuid;
begin
  if p_disposition not in ('in_use','spare','awaiting_repair','to_remove') then
    raise exception 'invalid disposition %', p_disposition;
  end if;

  select client_id into v_client from public.devices where id = p_device_id;
  if v_client is null then
    raise exception 'device not found';
  end if;

  if not (
    public.is_rocking_staff()
    or (public.current_user_role() = 'client_manager' and v_client = public.current_client_id())
  ) then
    raise exception 'not allowed';
  end if;

  update public.devices
     set disposition            = p_disposition,
         disposition_note       = nullif(trim(p_note), ''),
         disposition_updated_at = now(),
         disposition_updated_by = auth.uid()
   where id = p_device_id;
end;
$$;

grant execute on function public.set_device_disposition(uuid, text, text) to authenticated;
