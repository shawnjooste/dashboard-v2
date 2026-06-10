# "Sign in as" (Staff Impersonation) — Design

**Date:** 2026-06-10
**Status:** Approved design
**Project:** Rocking Dashboard v2

## Context

Staff need to see exactly what a specific client user sees — across every surface, present and
future (devices, team, support, billing later) — to reproduce "I see something weird" reports.
The earlier device drill-down (Approach A) covers Datto data only. This is Approach B: a real
session swap, so RLS and every feature render with full fidelity because the session *is* the
target user's.

**Mechanics verified live:** `auth.admin.generateLink({type:"magiclink"})` (service role) returns a
`hashed_token` without emailing the user; `verifyOtp({token_hash, type:"magiclink"})` mints a full
session (access + refresh) for them.

## Core flow

1. **Start** — On a client drill-in page (`/admin/clients/[id]`), a new **Users** section lists
   that client's profiles with a **Sign in as** button per eligible user. The button posts a
   server action:
   - Caller must be `rocking_staff` (checked server-side, not just UI).
   - Target must exist, be `status='active'`, have a `client_id`, and **must not be
     `rocking_staff`** (staff can never impersonate staff — same philosophy as the
     approve-RPC guard).
   - Refuse if already impersonating (no nesting; exit first).
   - Write an **audit row** (see below) via the service client.
   - **Back up** the caller's Supabase auth cookies (all cookies whose name starts with `sb-`
     and contains `-auth-token`, including chunked `.0/.1` variants) into `imp-bak.<name>`
     httpOnly cookies.
   - Mint the target session (generateLink → verifyOtp on the cookie-writing server client),
     which overwrites the auth cookies with the target's session.
   - Set an httpOnly **marker cookie** `imp` containing JSON `{ logId, email }` (audit row id +
     target email, for the banner and exit bookkeeping).
   - Redirect to `/` — the client surface now renders as the target.

2. **While impersonating**
   - **Banner**: both layouts read the marker cookie and render a fixed amber banner above the
     shell: "Viewing as {email} — read-only" + an **Exit** button (form POST to the exit route).
   - **Read-only, enforced in middleware**: if the marker cookie is present, every request with a
     method other than GET/HEAD is rejected with 403 — except POST `/impersonation/exit`. All our
     mutations are server actions (POSTs), so this is a global guarantee, not per-page opt-in.
     `/auth/signout` is therefore also blocked while impersonating (Exit is the only way out;
     prevents orphaning the backed-up admin session).

3. **Exit** — POST `/impersonation/exit` (route handler, outside the gated route groups):
   - Requires the marker cookie (404 otherwise).
   - Deletes ALL current `sb-*-auth-token*` cookies (the target's session — chunk counts may
     differ from the admin's), then restores every `imp-bak.*` cookie to its original name and
     deletes the backups + marker.
   - Stamps `ended_at` on the audit row (service client, using `logId` from the marker).
   - Redirects to `/admin`.

## Audit (migration `0015_impersonation_log.sql`)

```
impersonation_log: id uuid pk, staff_profile_id uuid not null references profiles,
target_profile_id uuid not null references profiles, target_email text not null,
started_at timestamptz not null default now(), ended_at timestamptz
```
RLS enabled; SELECT for `rocking_staff` only; no insert/update policies (writes go through the
service client only). FKs deliberately have **no** `on delete cascade` (default NO ACTION): an
audit row must never vanish silently, so deleting a profile with impersonation history fails
loudly. Profile deletion isn't a product feature, so this is acceptable.

## Session-restore correctness

- Backups hold the admin's access+refresh tokens. Refresh tokens stay valid until *used*, so even
  if the admin's access token expires mid-impersonation, the restored client auto-refreshes on
  the next request. Token rotation of the *target's* session while impersonating only touches the
  live cookies, never the backups.
- Restore must delete current auth cookies before writing backups (chunk-count mismatch safety).

## Security posture

- Service-role key stays server-side (used for generateLink + audit writes inside server
  actions/route handlers only).
- The marker cookie is httpOnly; tampering is a non-concern (the holder is already the
  privileged party — middleware read-only blocking is accident-prevention, not adversarial).
- Target receives no email and no notification; impersonation is invisible to them (deliberate —
  it's a support tool; the audit log is the accountability mechanism).
- Eligibility guards prevent: impersonating staff, pending/unassigned users, nested impersonation.

## UI details

- **Users section** on `/admin/clients/[id]`: table of that client's profiles (email, role,
  status) — staff RLS already permits this read — with "Sign in as" on eligible rows.
- **Banner**: amber, full-width, above the AppShell header/sidebar, visible on every page of both
  surfaces while the marker cookie exists.

## Error handling

- generateLink/verifyOtp failure mid-start: nothing destructive has happened to the admin's
  cookies until verifyOtp succeeds (backup happens first, original cookies still in place);
  return an error state, delete any backup cookies, never half-swap. Audit row may remain with
  null ended_at + a failure is acceptable (start logged, never active) — keep simple.
- Exit without marker → redirect `/admin`.
- Middleware 403 body is JSON `{error:"read-only while impersonating"}`.

## Out of scope

Acting as the user (writes), impersonation from anywhere other than the client drill-in,
notification to the target, session-timeout auto-exit (the target session naturally expires;
worst case Exit still restores the admin from backups).

## Testing

- Pure cookie-helper unit tests (name matching, backup/restore name mapping).
- Live probe already done for the mint mechanics.
- Manual walkthrough: admin → GSR Law → Sign in as a member → banner + member surfaces render
  as them → mutation attempt blocked (e.g. claim device returns 403) → Exit → admin restored.
- build/tsc/lint/test all green.

## Files

- Create: `supabase/migrations/0015_impersonation_log.sql`, `lib/impersonation.ts` (cookie
  helpers + marker codec; pure parts tested in `lib/impersonation.test.ts`),
  `app/(admin)/admin/clients/[id]/UsersSection.tsx` (server component + action wiring),
  `app/(admin)/admin/clients/[id]/actions.ts` (startImpersonation),
  `app/impersonation/exit/route.ts`
- Modify: `app/(admin)/admin/clients/[id]/page.tsx` (add Users section),
  `lib/supabase/middleware.ts` (read-only block), `app/(app)/layout.tsx` +
  `app/(admin)/layout.tsx` (banner), `components/AppShell.tsx` (banner slot)
