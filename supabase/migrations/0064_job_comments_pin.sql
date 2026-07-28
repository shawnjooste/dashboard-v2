-- Jobs v2 phase 3. Three additions:
--   1. job_comments — staff discussion on a job. Separate from jobs.notes
--      (standing context) and from job_updates (what the client was told).
--      Staff-only, never emailed.
--   2. jobs.pinned — the "golden ticket": sorts a card to the top of its column.
--   3. job_updates gains 'status' and 'assigned' so the same table can carry the
--      internal activity trail. The client-updates panel keeps its meaning by
--      filtering to the original three kinds (see lib/job-activity.ts).
create table public.job_comments (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references public.jobs(id) on delete cascade,
  body              text not null,
  author_profile_id uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index job_comments_job_idx on public.job_comments (job_id, created_at);

alter table public.job_comments enable row level security;
create policy job_comments_staff on public.job_comments
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

alter table public.jobs add column pinned boolean not null default false;

alter table public.job_updates drop constraint job_updates_kind_check;
alter table public.job_updates add constraint job_updates_kind_check
  check (kind in ('opened','update','completed','status','assigned'));
