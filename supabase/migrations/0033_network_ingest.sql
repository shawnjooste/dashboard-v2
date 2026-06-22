-- Slice 2 — the network ingestion boundary. A scoped role (network_ingestor)
-- may execute exactly two SECURITY DEFINER functions and nothing else, so the
-- off-box collector (jarvis) holds no service-role key: its only capability is
-- "submit a network report" / "ask what to pull".

-- What the collector should pull (source of truth = network_source_aliases).
create or replace function public.network_ingest_targets()
returns table (source text, source_key text, label text)
language sql security definer set search_path = public
as $$
  select source, source_key, label from public.network_source_aliases order by source, label;
$$;

-- Idempotent ingest of one source-site's report. Ports the slice-1 JS upsert
-- into the DB: resolve client, open an import_run, upsert site + devices, write
-- the daily snapshot. Unknown alias ⇒ raise (never guess which client).
create or replace function public.ingest_network_report(payload jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_source text := payload->>'source';
  v_key    text := payload->>'source_key';
  v_name   text := coalesce(payload->>'site_name', payload->>'source_key');
  v_date   date := coalesce(nullif(payload->>'report_date','')::date, current_date);
  v_ccount int  := nullif(payload->>'client_count','')::int;
  v_client uuid;
  v_run    uuid;
  v_site   uuid;
  v_total  int;
  v_up     int;
  v_down   int;
  v_alert  int;
  v_status text;
  v_last   timestamptz;
begin
  if v_source is null or v_key is null then
    raise exception 'ingest_network_report: source and source_key are required';
  end if;

  select client_id into v_client
    from public.network_source_aliases
   where source = v_source and source_key = v_key;
  if v_client is null then
    raise exception 'ingest_network_report: no alias for % / %', v_source, v_key;
  end if;

  select count(*),
         count(*) filter (where d->>'status' = 'online'),
         count(*) filter (where d->>'status' = 'offline'),
         count(*) filter (where d->>'status' = 'alerting'),
         max(nullif(d->>'last_seen_at','')::timestamptz)
    into v_total, v_up, v_down, v_alert, v_last
    from jsonb_array_elements(coalesce(payload->'devices','[]'::jsonb)) as d;

  v_status := case
                when v_total > 0 and v_up = 0 then 'offline'
                when v_down > 0 or v_alert > 0 then 'degraded'
                else 'online'
              end;
  v_last := coalesce(v_last, now());

  insert into public.import_runs (source, report_date, counts)
  values ('network:'||v_source, v_date, jsonb_build_object('devices', v_total, 'up', v_up, 'down', v_down))
  returning id into v_run;

  insert into public.network_sites
    (client_id, source, source_site_id, name, status, device_count, client_count, last_seen_at, last_import_run_id, updated_at)
  values
    (v_client, v_source, v_key, v_name, v_status, v_total, v_ccount, v_last, v_run, now())
  on conflict (source, source_site_id) do update
    set client_id = excluded.client_id, name = excluded.name, status = excluded.status,
        device_count = excluded.device_count, client_count = excluded.client_count,
        last_seen_at = excluded.last_seen_at, last_import_run_id = excluded.last_import_run_id, updated_at = now()
  returning id into v_site;

  insert into public.network_devices
    (client_id, site_id, source, source_device_id, name, kind, model, ip, status, firmware, uptime_s, client_count, last_seen_at, last_import_run_id, updated_at)
  select v_client, v_site, v_source, d->>'source_device_id', d->>'name', d->>'kind', d->>'model', d->>'ip',
         d->>'status', d->>'firmware', nullif(d->>'uptime_s','')::bigint, nullif(d->>'client_count','')::int,
         nullif(d->>'last_seen_at','')::timestamptz, v_run, now()
    from jsonb_array_elements(coalesce(payload->'devices','[]'::jsonb)) as d
  on conflict (source, source_device_id) do update
    set client_id = excluded.client_id, site_id = excluded.site_id, name = excluded.name, kind = excluded.kind,
        model = excluded.model, ip = excluded.ip, status = excluded.status, firmware = excluded.firmware,
        uptime_s = excluded.uptime_s, client_count = excluded.client_count, last_seen_at = excluded.last_seen_at,
        last_import_run_id = excluded.last_import_run_id, updated_at = now();

  insert into public.network_health_snapshots
    (client_id, site_id, snapshot_date, devices_total, devices_up, devices_down, client_count, status)
  values
    (v_client, v_site, v_date, v_total, v_up, v_down, v_ccount, v_status)
  on conflict (site_id, snapshot_date) do update
    set devices_total = excluded.devices_total, devices_up = excluded.devices_up,
        devices_down = excluded.devices_down, client_count = excluded.client_count, status = excluded.status;

  return jsonb_build_object('client_id', v_client, 'site_id', v_site,
                            'devices', v_total, 'up', v_up, 'down', v_down, 'status', v_status);
end;
$$;

-- Scoped ingestion role: EXECUTE on the two functions, nothing else ----------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'network_ingestor') then
    create role network_ingestor nologin;
  end if;
end $$;
grant network_ingestor to authenticator;
grant usage on schema public to network_ingestor;

revoke all on function public.network_ingest_targets()       from public, anon, authenticated;
revoke all on function public.ingest_network_report(jsonb)   from public, anon, authenticated;
grant execute on function public.network_ingest_targets()    to network_ingestor;
grant execute on function public.ingest_network_report(jsonb) to network_ingestor;
