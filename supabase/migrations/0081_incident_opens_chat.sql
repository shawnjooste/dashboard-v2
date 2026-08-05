-- Incident mode. An active incident can open live chat to everyone it
-- affects, whatever support tier they are on — the thing you want during an
-- outage, when the last thing anyone needs is a queue.
--
-- Deliberately a flag on the incident rather than a switch of its own:
-- resolving the incident (which you do anyway) closes chat again, so there is
-- nothing left on by accident. Scope comes free too — a client-scoped
-- incident opens chat only for the clients it targets.
--
-- Spec: docs/superpowers/specs/2026-08-05-incident-mode-design.md

alter table public.status_incidents
  add column if not exists opens_chat boolean not null default false;

comment on column public.status_incidents.opens_chat is
  'While this incident is active, everyone who can see it gets live chat regardless of their support package.';
