# Project: Rocking Portal (dashboard-v2)

The Rocking client portal: Next.js 16 (App Router) on Vercel + Supabase
(Postgres + Auth + RLS). Two surfaces — Rocking staff/admin and clients — over
one shared data layer. Live at `portal.rocking.one`.

## Supabase — read this before any DB command

**Always use project ref `eskhokedsximnslgsycs`.**

- Link: `supabase link --project-ref eskhokedsximnslgsycs`
- Migrations: `npx supabase db push --linked`
- Types: `npx supabase gen types typescript --linked > lib/types/database.ts`
- Keys (service role, anon, Resend, Paystack, Crisp, Xero) live in `.env.local`,
  gitignored. Never paste a secret into chat; read it from the file at runtime.

> There is an OLD project, "The Dashboard" (`qomxwxxulxcwnpaqzudl`), in a
> different repo. Never point this repo at it. If you see instructions about a
> `preview` branch, they belong to that repo, not this one.

**Migration numbers collide.** Parallel sessions work this repo at once. Before
adding a migration, check BOTH `ls supabase/migrations` and
`npx supabase migration list --linked` and take the next genuinely free number.

## Roles & tenancy

- `rocking_staff` — any `@rocking.one` email (auto; cross-client admin).
- `client_manager` — assigned manually; sees their whole company.
- `client_member` — sees only their own assigned device(s).
- Passwordless auth (magic link via Resend, domain `send.rocking.one`).
- Non-Rocking domains map to a company via `client_domains`; unknown → `pending`.
- Per-user feature access: role gives defaults, `profiles.feature_overrides`
  subtracts. Billing and quotes are enforced in RLS via `has_feature()`, not
  just hidden in nav.

## Git workflow

- **All development happens directly on `main`.** Commit and push to `main`.
- Conventional commit messages.
- If git hangs on `.git/index.lock`, Cursor's git worker holds it — remove the
  stale lock and retry.

## How we work

1. **Design before code.** Anything non-trivial gets a spec in
   `docs/superpowers/specs/`, then a task-by-task plan in
   `docs/superpowers/plans/`, then the build. Specs record *decisions and why*
   so later sessions don't relitigate them.
2. **Pure logic gets extracted and unit-tested** (vitest). Ranking, mapping,
   validation and money/time maths live in their own import-free module with a
   test file — see `lib/security/rollup.ts`, `lib/job-nudge.ts`,
   `lib/feature-access.ts`. Vitest must never import `@/lib/supabase/server`.
3. **Verify, don't claim.** `npm test && npm run build` before saying anything
   is done, plus a live check against real data where it matters (query the DB
   with the service role, or drive the page in a browser). Report failures
   plainly.
4. **Adversarial review for anything touching security, money, or data
   integrity** — dispatch a reviewer whose job is to break it, then fix what it
   finds. This has caught real bugs (silent mass-resolution of security
   findings, RLS gaps) that ordinary review missed.
5. **Ask before destructive or outward-facing actions** — sending client email,
   deleting data, spending money. Show drafts first.

## Environment traps (they will bite)

- Node lives at `~/.local/bin/node` — not always on PATH over SSH.
- Stale `.next/* 2.*` files (Finder-style duplicates) break `npx tsc --noEmit`
  with bogus duplicate-identifier errors: `find .next -name "* 2.*" -delete`.
- The dev server reads `.env.local`, so **local dev talks to PRODUCTION
  Supabase**. Never test destructive flows against real client rows — create a
  throwaway record, use it, delete it.
- Vercel rejects request bodies over ~4.5 MB before our code runs; uploads must
  shrink/chunk client-side (see `components/AddDevicePhotos.tsx`).

## Scheduled jobs

launchd agents on Shawn's Mac (only run while it's awake) — `launchctl list | grep rocking`:
`com.rocking.datto-pull` 02:15 · `com.rocking.m365-pull` 02:30 ·
`com.rocking.xero-pull` 02:45 · `com.rocking.security-normalize` 03:00.
Logs in `~/Library/Logs/rocking-*.log`. Vercel crons handle the weekly time
nudge and monthly upsell digest.

## Current programmes

- **MDR security pivot** — the portal is becoming an agent-powered MDR console
  (Arctic Wolf model). Sub-projects: A data plane ✅, B SOC console ✅,
  C detection/triage agents (next), D incident workflow, E client-facing
  posture. Specs dated 2026-07-24.
- **Support packages** — the portal is the support gate; the ticket is the
  anchor for all paid/covered work. FreeScout is proxied, never mirrored.
  Spec dated 2026-07-14 plus the 2026-08-01 reshape.

Both have detailed decision history in Claude's memory files — read those
before reopening a settled question.
