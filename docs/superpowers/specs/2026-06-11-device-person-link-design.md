# Device ↔ Person Linking — Identity Layer Slice 2

**Date:** 2026-06-11
**Status:** Approved design
**Project:** Rocking Dashboard v2

## Context

Slice 1 built the `people` directory (email-anchored) with M365 + portal logins attached. Devices
are the one product with no email-native key. Probed live: `lastLoggedInUser` is the best signal
(GSR: 47% exact-match to a person's email local-part, vs Entra-owner which was actively wrong), and
misses are near-matches (`Anitam`→`anita`, `BelindaL`→`belinda`). So: **auto-suggest (fuzzy) + human
confirm** — never blind auto-link (shared accounts, reassigned machines).

## Schema (migration `0021_device_person.sql`)

- `devices.person_id uuid references people(id) on delete set null` — the **confirmed** link.
- `devices.last_user text` — the Datto `lastLoggedInUser` (for display + suggestion).
- The Datto pull stores `last_user` but **never writes `person_id`** (human-owned; survives re-pulls).

## Suggestion (pure, tested) — `lib/views/device-link.ts`

`suggestPerson(device, people)` → best `{ person, score }` or null, scoring each person:
- email local-part `===` device username (strip `DOMAIN\`) → 100 (exact)
- username starts-with email-local (len ≥ 3) → 85 (`anitam`→`anita`)
- email-local starts-with username (len ≥ 3) → 75
- person first-name `===` Datto `assigned_user_label` → 60 (label "Rose" → person Rose)
Only suggest when score ≥ 60. Live-computed; never persisted until confirmed.

## Datto pull change

`scripts/datto-pull.mjs`: add `last_user: d.lastLoggedInUser ?? null` to the device upsert. (The
upsert already omits `person_id`, so confirmed links are preserved.)

## UI (admin)

1. **Bulk linker** `app/(admin)/admin/clients/[id]/link-devices/page.tsx` — the efficient first-run
   surface: a single form, one row per device (hostname · last-login · a person `<select>`
   pre-selected to the suggestion, blank if none), one **Save links** server action that sets
   `person_id` for each changed row. Linked rows show their current person.
2. **Device detail** (`/admin/devices/[id]`): a "Person" card — linked person (→ 360) with "Change",
   or the suggestion + Confirm + a manual picker. Same `linkDevicePerson(deviceId, personId|null)`
   staff-only server action.
3. **Person 360** devices section: replace the placeholder with the person's linked device(s)
   (hostname, health badge, link to device detail).
4. Links: "Link devices →" from the client People page; "Person" card on device detail.

## Server action — `linkDevicePerson`

Staff-only (re-checked server-side). Sets/clears `devices.person_id` via the service client (writes
to devices are service-role only by RLS). `revalidatePath` the affected pages.

## Error handling

- Person/device out of caller scope or bad id → action no-ops with an error; pages show "not found".
- A device whose `last_user` matches nobody → no suggestion; dropdown blank; staff pick manually.
- Re-running the Datto pull never disturbs confirmed links.

## Testing

- Pure unit tests for `suggestPerson` (exact, prefix both directions, label fallback, no-match,
  shared-account ambiguity).
- Live: re-pull Datto (populate `last_user`), open the bulk linker for GSR, confirm suggestions,
  verify the 360 shows the device and the device shows the person.
- build / tsc / lint / tests green; regenerate `database.ts`.

## Out of scope

Auto-linking without confirmation, member/manager-facing linking (admin only), device→person for
non-Datto device sources (there are none).

## Files

- Create: `supabase/migrations/0021_device_person.sql`, `lib/views/device-link.ts` (+ test),
  `app/(admin)/admin/clients/[id]/link-devices/page.tsx`,
  `app/(admin)/admin/clients/[id]/link-devices/actions.ts`
- Modify: `scripts/datto-pull.mjs` (last_user), `app/(admin)/admin/devices/[id]/page.tsx`
  (Person card + action), `lib/views/people.ts` (Person 360 devices), `lib/views/devices.ts`
  (expose person link if needed), `app/(admin)/admin/clients/[id]/people/page.tsx` (link),
  `lib/types/database.ts` (regen)
