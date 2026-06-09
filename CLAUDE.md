# Project: Rocking Dashboard v2 (rebuild)

Clean-slate rebuild of the Rocking client portal: Next.js (App Router) on Vercel +
Supabase (Postgres + Auth + RLS). Two surfaces (Rocking staff/admin + clients),
one shared data layer. Slice 1 = foundation + Datto ingestion.

## Supabase

**Always use project ref `eskhokedsximnslgsycs` for all `supabase` CLI commands on this project.**

- Project URL: `https://eskhokedsximnslgsycs.supabase.co`
- Link: `supabase link --project-ref eskhokedsximnslgsycs`
- Deploy functions: `supabase functions deploy <name> --project-ref eskhokedsximnslgsycs`
- Push migrations: `supabase db push`
- DB password, anon key, service-role key, and Resend key live in `.env.local` (gitignored).

> NOTE: This is a NEW project, distinct from the old "The Dashboard"
> (`qomxwxxulxcwnpaqzudl`), which keeps running until cutover. Never point this
> repo at the old project.

## Roles & tenancy

- `rocking_staff` — anyone with a `@rocking.one` email (auto, cross-client admin).
- `client_manager` — assigned manually; sees their whole client's fleet.
- `client_member` — sees only devices assigned to them.
- Auth is passwordless (Supabase email OTP / magic link via Resend, domain `send.rocking.one`).
- Non-rocking domains map to a client via `client_domains`; unknown domains land `pending`.

## Git Workflow

- Development happens on `main` for now (solo rebuild). Branch for risky work.
- Conventional commit messages.

## Specs & Plans

- Design spec and implementation plans live under `docs/superpowers/`.
- Slice 1 is built across four plans (foundation → auth → ingestion → views);
  build them in order, each against the real prior foundation.
