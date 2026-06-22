-- Jobs — admin work tracker. A job is a card (client, owner, status, notes,
-- optional linked quote) with a checklist of tasks and an activity/update log.
-- Staff-only throughout; clients never see these rows.

create table public.jobs (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  title            text not null,
  owner_profile_id uuid references public.profiles(id) on delete set null,
  status           text not null default 'todo'
                     check (status in ('todo','in_progress','waiting','done','cancelled')),
  notes            text,
  waiting_note     text,                       -- shown as the card tag while status = 'waiting'
  quote_id         uuid references public.quotes(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index jobs_client_idx on public.jobs (client_id);
create index jobs_status_idx on public.jobs (status);

create table public.job_tasks (
  id                  uuid primary key default gen_random_uuid(),
  job_id              uuid not null references public.jobs(id) on delete cascade,
  label               text not null,
  done                boolean not null default false,
  assignee_profile_id uuid references public.profiles(id) on delete set null,
  position            int not null default 0,
  created_at          timestamptz not null default now()
);
create index job_tasks_job_idx on public.job_tasks (job_id);

-- Activity log + client-update record. 'opened'/'completed' are auto; 'update'
-- is a manual "Post update" (which also emails the client's managers).
create table public.job_updates (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid not null references public.jobs(id) on delete cascade,
  kind                 text not null check (kind in ('opened','update','completed')),
  body                 text,
  posted_by_profile_id uuid references public.profiles(id) on delete set null,
  emailed_count        int not null default 0,
  created_at           timestamptz not null default now()
);
create index job_updates_job_idx on public.job_updates (job_id);

-- RLS: rocking_staff only (read + write). ---------------------------------
alter table public.jobs         enable row level security;
alter table public.job_tasks    enable row level security;
alter table public.job_updates  enable row level security;

create policy jobs_staff on public.jobs
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy job_tasks_staff on public.job_tasks
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy job_updates_staff on public.job_updates
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
