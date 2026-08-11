-- Onboarding email sequence.
--
-- Two tables, and the distinction between them is the whole design:
-- `state` says who is enrolled; `sends` records only steps that are SETTLED
-- and will never be reconsidered. A step whose feature or data gate fails is
-- NOT settled — it gets no row, so granting that feature months later makes
-- the step eligible again on the next run.

create table public.onboarding_sequence_state (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  -- No 'done': the sequence stays open so a late feature grant can still fire.
  status      text not null default 'active'
                check (status in ('active', 'stopped'))
);

create table public.onboarding_sequence_sends (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  step_key   text not null,
  decided_at timestamptz not null default now(),
  -- Settled outcomes only. A failed gate is "not eligible yet", not an outcome.
  outcome    text not null
               check (outcome in ('sent', 'skipped_already_using', 'suppressed')),
  primary key (profile_id, step_key)
);

-- The runner asks "what has this person already settled?" and
-- "when did they last actually receive one?".
create index onboarding_sends_profile_idx
  on public.onboarding_sequence_sends (profile_id, decided_at desc);

alter table public.onboarding_sequence_state enable row level security;
alter table public.onboarding_sequence_sends enable row level security;

-- Staff-read-only, matching portal_activity. All writes are service-role,
-- which bypasses RLS; no client user ever reads or writes these.
create policy "staff read onboarding state" on public.onboarding_sequence_state
  for select using (public.is_rocking_staff());
create policy "staff read onboarding sends" on public.onboarding_sequence_sends
  for select using (public.is_rocking_staff());
