-- Slice 2: link Datto devices to canonical people. person_id is the CONFIRMED
-- link (human-owned, never written by the pull). last_user is the Datto
-- lastLoggedInUser, used for display + the auto-suggestion.
alter table public.devices add column person_id uuid references public.people(id) on delete set null;
alter table public.devices add column last_user text;
create index devices_person_idx on public.devices (person_id);
