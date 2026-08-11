# Portal Update Opt-out — Design

**Date:** 2026-08-06
**Status:** Approved in conversation (Shawn).

## Purpose

People need a way to stop receiving portal announcements without losing the
email they actually need. This is not a marketing unsubscribe — the portal
sends almost entirely transactional mail. It is one narrow switch:
**Portal Updates off.**

## The safety rule that shapes everything

**Only `category = "portal_update"` is ever suppressed.** Quotes, bookings,
agreements, job updates, welcome/sign-in links, company-detail changes and
internal alerts always send, regardless of any preference. A person who opts
out of Portal Updates must still receive the quote they are waiting for.

The suppressible set is an explicit allow-list of one
(`SUPPRESSIBLE_CATEGORIES`). A category added later is deliverable unless
someone deliberately adds it to that set — the default is always "this mail
goes".

## Data

Migration (take the next genuinely free number — check `ls
supabase/migrations` AND `npx supabase migration list --linked`; parallel
sessions work this repo).

```sql
alter table public.profiles
  add column portal_updates_opt_out boolean not null default false;
```

One boolean, default false (everyone opted in). Deliberately not a jsonb
preferences bag: there is exactly one toggle today, and a boolean is honest
about that. Widen only when a second preference actually exists.

## Enforcement — in the send chokepoint

`lib/email/send.ts` is the single door every portal email goes through. The
filter lives there, so a hand-written script that forgets to check still
cannot reach an opted-out person.

New pure module `lib/email/suppression.ts` (import-free, vitest-covered):

- `SUPPRESSIBLE_CATEGORIES: ReadonlySet<string>` — `{"portal_update"}`.
- `isSuppressible(category: string | undefined): boolean`
- `splitRecipients(to: string[], category: string | undefined, optedOut: Set<string>): { send: string[]; suppressed: string[] }`
  — case-insensitive on addresses; returns everything in `send` when the
  category isn't suppressible; never mutates its inputs.

`sendEmail()` changes:

1. If `isSuppressible(opts.category)`, look up opted-out addresses among
   `opts.to` (one query: profiles where `lower(email) in (...)` and
   `portal_updates_opt_out`), then `splitRecipients`.
2. If `send` is empty → **do not call Resend and do not write `sent_emails`**.
   Nobody received it, so no phantom row in anyone's Communications history.
   Return `{ id: null, suppressed }`.
3. Otherwise send to `send` only, record as today (the recorded `to_emails`
   reflects who was actually mailed), and return `{ id, suppressed }`.

Return type becomes `{ id: string | null; suppressed: string[] }`. Existing
callers destructure `id` and are unaffected.

`cc`/`bcc` are **not** filtered: they carry internal copies (accounts@,
support@) rather than subscriber recipients. Portal Updates should address
people via `to`.

## Recipient helper

`lib/views/portal-updates.ts` → `getPortalUpdateRecipients(clientId?: string)`
returns `{ eligible: {email, name, clientName}[]; optedOut: {email, name}[] }`
for active client users, optionally scoped to one company. Staff-only (RLS).

Purpose: before an announcement goes out, show exactly who will receive it and
who won't — the send itself is still protected by the chokepoint, so this is
for preview and confidence, not enforcement.

## UI

**`/communications`** — a card above the email list:

> **Portal updates**
> Occasional news about new portal features and improvements.
> Quotes, bookings and support emails are always sent.
> `[ ✓ ] Send me portal updates`

Saves on toggle (server action, no Save button). A user may only change their
own preference.

**`/admin/users`** — the same toggle per client user, staff-editable,
alongside the existing Access control. Staff may change anyone's; the guard
lives in the action, not the UI.

Both use one action, `setPortalUpdateOptOut(profileId, optOut)`:
staff may set it for any client user; a non-staff caller may set it only for
`auth.uid()`. Rejects any attempt to set it on a `rocking_staff` profile from
the client surface.

## Email footer

Portal Update emails only (never any other category): one muted line at the
end —

> You're getting this because you use the Rocking portal.
> [Turn off portal updates](https://portal.rocking.one/communications)

Rendered by a small helper in `lib/onboarding-email.ts`'s neighbourhood
(`lib/email/portal-update-footer.ts`) so any future Portal Update template
picks it up.

## Testing

- Vitest on `lib/email/suppression.ts`: non-suppressible category passes
  everyone through untouched; opted-out addresses dropped for
  `portal_update`; case-insensitive matching; all-opted-out yields an empty
  `send`; inputs not mutated.
- Vitest on the footer helper: renders the link; is only ever called for
  portal updates (asserted by the send path's own test at call level).
- Live verification: set the flag on a throwaway profile, send a
  `portal_update` to that address plus one opted-in address — confirm only the
  opted-in address receives it and `sent_emails.to_emails` records only that
  one; send a `quote` category to the same opted-out address and confirm it
  **is** delivered (the safety rule holds). Clean up after.

## Out of scope

Client-level (whole-company) opt-out; multiple preference types; a preferences
page separate from Communications; suppression of `cc`/`bcc`; opt-out for
people who aren't portal users (no profile = no preference = they receive it);
re-subscribe emails or confirmation mail on toggling.
