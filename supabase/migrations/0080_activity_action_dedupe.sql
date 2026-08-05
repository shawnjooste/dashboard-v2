-- The hourly dedupe on portal_activity was written for page views — one row
-- per user/section/hour, so a reader clicking around doesn't flood the feed.
-- But the unique index covered EVERY kind, including 'action'. A second action
-- in the same section within the same hour raised a unique violation that
-- trackAction swallowed, so it vanished: two tickets raised in one hour logged
-- as one, and a status opt-out followed by an opt-in logged only the opt-out.
--
-- Restrict the dedupe to the kinds that actually want it. Actions are discrete
-- events and must always be recorded.

drop index if exists public.portal_activity_dedupe_idx;

create unique index portal_activity_dedupe_idx
  on public.portal_activity (profile_id, kind, section, hour_bucket)
  where kind in ('visit', 'login');

-- PostgREST's upsert can't express the predicate a partial index needs for
-- ON CONFLICT inference, so the deduped insert moves into a function. Returns
-- the new row's id, or nothing when this hour's visit is already recorded —
-- which is how trackVisit still tells a fresh session from a repeat view.
create or replace function public.record_portal_visit(
  p_profile_id uuid,
  p_client_id  uuid,
  p_kind       text,
  p_section    text
)
returns uuid
language sql
security definer
set search_path = public
as $$
  insert into public.portal_activity (profile_id, client_id, kind, section)
  values (p_profile_id, p_client_id, p_kind, p_section)
  on conflict (profile_id, kind, section, hour_bucket)
    where kind in ('visit', 'login')
  do nothing
  returning id;
$$;

-- Called only by the service role from trackVisit; never exposed to clients.
revoke all on function public.record_portal_visit(uuid, uuid, text, text) from public, anon, authenticated;
