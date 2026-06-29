-- Richer device alerts: a friendly type label + the raw Datto alert context
-- (disk free space, event-log type, etc.) for an expandable detail view.
alter table public.device_alerts
  add column if not exists alert_type text,
  add column if not exists context    jsonb;
