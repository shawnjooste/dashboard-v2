-- Jobs v2 phase 1: a job-level target date, and manual ordering within a board
-- column. board_position is renumbered 0..n-1 across a column on every drop, so
-- gaps never accumulate.
alter table public.jobs add column due_date date;
alter table public.jobs add column board_position int not null default 0;

create index jobs_status_position_idx on public.jobs (status, board_position);
