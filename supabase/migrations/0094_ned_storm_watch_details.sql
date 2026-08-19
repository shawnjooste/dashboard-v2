-- 0094: add details jsonb to ned_storm_watch
-- Holds the full per-capture diagnostic breakdown written by the NED loop.
-- No RLS changes needed: the existing table policy covers the new column.

alter table public.ned_storm_watch
  add column details jsonb;

comment on column public.ned_storm_watch.details is
  'Full per-capture diagnostic breakdown written by the NED loop: protocols, ARP breakdown, top talkers, TCP expert analysis, L2 stats, issues, and LibreNMS snapshot.';
