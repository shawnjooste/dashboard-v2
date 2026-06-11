# Identity Layer (User 360) — Slice 1 Design

**Date:** 2026-06-11
**Status:** Approved design
**Project:** Rocking Dashboard v2

## Context

Products (Datto, M365, future INKY/billing) each describe people differently and share no key —
except **email**. Rather than N×N point-to-point links, introduce a canonical **Person** per client
(golden-record / identity-resolution pattern), anchored by email, that every product attaches to.
Email-native products auto-link; the one hard case (devices) is resolved once *to the Person*
(Slice 2), after which device↔M365 comes for free.

This slice builds the identity layer and wires the **email-native** sources (M365 + portal logins)
+ a People list and Person 360 view. Device linking is **Slice 2**; future products **Slice 3**.

## Decisions (settled in brainstorming)

- `people` and `profiles` stay **separate**: `people` = directory of every human at a client;
  `profiles` = portal login accounts, which gain a `person_id` link. Most people have no profile.
- **Email is the universal upsert key.** Any source creates-or-attaches a Person, deduped on
  `(client_id, lower(email))`. One `upsert_person` helper holds the dedup logic.
- **Only active (enabled) M365 accounts create people** — disabled leavers don't pollute the directory.

## Schema (migration `0020_people.sql`)

- **`people`**: `id uuid pk`, `client_id uuid not null → clients`, `email text not null` (stored
  lowercased), `display_name text`, `is_active boolean not null default true`, `created_at`,
  `updated_at`. Unique index `(client_id, lower(email))`. `set_updated_at` trigger.
  RLS: `is_rocking_staff()` all; client users `client_id = current_client_id()` (read).
- **`m365_users`** + `person_id uuid → people` (nullable).
- **`profiles`** + `person_id uuid → people` (nullable).
- **`upsert_person(p_client_id uuid, p_email text, p_display_name text, p_is_active boolean default true) returns uuid`**
  — SECURITY DEFINER. `insert … on conflict (client_id, lower(email)) do update` (coalesce
  display_name so we never null it; refresh is_active + updated_at) `returning id`. Single home for
  dedup. Granted to authenticated + used by the service client (pulls).
- **`link_profile_person()`** — BEFORE INSERT OR UPDATE trigger on `profiles`: when `client_id` is
  not null and `person_id` is null, `new.person_id := upsert_person(new.client_id, new.email, null)`.
  Covers every path a profile gains a client: matched-domain signup (`handle_new_user` insert) and
  pending→active approval (`approve_pending_user` update). Staff/pending (null client) get no person.
- One-time backfill in the migration: `update profiles set updated_at = now() where client_id is
  not null and person_id is null;` (re-fires the BEFORE trigger to link existing client members).

## Population

- **M365 pull** (`scripts/m365-pull.mjs`): for each **enabled** account, call `upsert_person`
  (email=UPN, display_name, is_active=true) and set `m365_users.person_id`. Disabled accounts leave
  `person_id` null and create no Person. Re-running is idempotent.
- **Portal logins**: handled by the `link_profile_person` trigger (no app code needed).

## Views

- **People view-model** `lib/views/people.ts`:
  - `getClientPeople(clientId)` → people for a client with quick flags: has M365 (+ licensed/MFA),
    has portal login (+ role/status). For the People list.
  - `getPerson360(personId)` → the Person + their M365 account (licenses, MFA, enabled), their portal
    profile (role/status), and a devices placeholder (populated in Slice 2). RLS-scoped.
- **UI**:
  - `app/(admin)/admin/clients/[id]/people/page.tsx` — People list (name, email, M365 badge,
    login badge), linking to the 360.
  - `app/(admin)/admin/people/[id]/page.tsx` — **Person 360**: header (name/email), M365 card
    (status, licenses, MFA strong?), portal-login card (role/status or "no portal login"),
    Devices section ("device linking arrives next" placeholder).
  - A **People** link on the client drill-in (`/admin/clients/[id]`), beside the M365 button.

## Error handling

- `upsert_person` with a blank email → guarded (skip; a Person must have an email anchor).
- Person not visible to caller (RLS) or bad id → 360 page shows "not found".
- M365 pull: person upsert failure for one user logged + skipped, doesn't abort the run.

## Testing

- pgTAP (CI) / rolled-back probe: `upsert_person` dedupes on (client_id, lower(email)); the
  `link_profile_person` trigger links a member profile.
- Live: re-run M365 pull for GSR Law → people created for the ~38 active accounts, `m365_users`
  linked; verify counts + a sample 360.
- build / tsc / lint / existing tests green; regenerate `database.ts`.

## Out of scope (later slices)

Device↔person linking (Slice 2), INKY/billing (Slice 3), manager/member-facing People UI (admin
only for now), manual person create/merge UI.

## Files

- Create: `supabase/migrations/0020_people.sql`, `lib/views/people.ts`,
  `app/(admin)/admin/clients/[id]/people/page.tsx`, `app/(admin)/admin/people/[id]/page.tsx`
- Modify: `scripts/m365-pull.mjs` (upsert people + link), `app/(admin)/admin/clients/[id]/page.tsx`
  (People link), `lib/types/database.ts` (regen)
