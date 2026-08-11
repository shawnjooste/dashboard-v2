# Connectivity Campaign — Design

**Date:** 2026-08-06
**Status:** Approved in conversation (Shawn) — enquiry-to-RFQ variant.

## Goal

Marketing, not plumbing: reveal the Connectivity section to clients who
currently can't see it, email them about it, and give the ones who *don't* buy
connectivity from us a way to ask for it. Clients who already have lines keep
seeing their live data.

## What's actually true today (measured 2026-08-06)

- 186 active portal users: **171 managers, 15 members**.
- Managers default to **every** section, including Connectivity. Members
  default to **none**, and the access model is deliberately subtractive — it
  can take a section away, never grant one.
- **66 users have Connectivity explicitly switched off** via
  `profiles.feature_overrides`. That, not a missing feature, is why they can't
  see it.
- Only **4 clients** have active `connectivity_services` rows. Everyone else
  landing on the page today sees one line — *"No connectivity services on your
  account yet."* — with no offer and nowhere to go.

## Scope

Three pieces. The first two are durable product; the third is a one-off data
change, deliberately not built as a feature.

### 1. Feature-aware targeting (`lib/views/portal-updates.ts`)

Extend `getPortalUpdateRecipients` to accept an optional filter:

```ts
getPortalUpdateRecipients(opts?: {
  clientId?: string;
  /** Only people who can actually SEE this section. */
  feature?: string;
  /** Only clients who actually HAVE this service's data. */
  hasService?: "connectivity";
}): Promise<{ eligible: Recipient[]; optedOut: Recipient[]; excluded: Recipient[] }>
```

- `feature` filters on real visibility — role defaults minus that user's
  `feature_overrides`, via the existing `canAccess()`. Nobody is ever emailed
  about a page they cannot open.
- `hasService` filters on data (active `connectivity_services` for the
  client), for the "you already have this, here's what's new" cut.
- `excluded` returns people filtered out by `feature`/`hasService` so a send
  preview can say *why* someone isn't on the list, not just that they aren't.
- Opted-out people are reported separately and never in `eligible`; the
  guarantee itself still lives in `lib/email/send.ts`.

### 2. Connectivity enquiry (the empty state that sells)

`/connectivity`, when the client has no active lines, replaces the dead-end
line with:

- A short pitch: fibre, wireless and LTE, installed and managed by Rocking,
  with live monitoring visible right here in the portal.
- A **"Check what's available at my address"** form: site address
  (required), current provider and speed (optional), a free-text note, and
  the contact to reach — defaulting to the signed-in user's name and email.
- Submitting creates an **RFQ** (`rfqs`) with `status = 'new'`, a title of
  `Connectivity enquiry — {client name}`, `client_id` set, `requested_by` the
  submitting person, and the address/provider/note in `description`. It lands
  on the existing admin RFQ board and flows RFQ → Quote as usual.
- Written by a staff-guarded-equivalent server action using the **service
  client** (the `rfqs` table is staff-only under RLS, and a client user must
  never get write access to it). The action verifies the caller is an
  authenticated client user and forces `client_id` to their own — a client can
  only ever raise an enquiry for their own company.
- After submitting, the card shows a plain confirmation ("We've got it —
  we'll come back to you with options") rather than clearing the form.
- Rate limit: refuse a second enquiry from the same client while one with
  `status = 'new'` already exists, and say so, so an eager click doesn't
  litter the RFQ board.
- Clients **with** lines see exactly what they see today — this changes only
  the empty state.

### 3. Revealing the section (one-off, not a feature)

Turning Connectivity back on for the 66 users who have it switched off is a
one-off data change: clear `connectivity` from their `feature_overrides`
(leaving every other override intact, and deleting the column value entirely
when nothing else remains). Run as a script, with the affected list shown to
Shawn for approval **before** it runs, and a printed before/after count.

Not built as an admin bulk-access page: this is expected to happen once. If a
second bulk reveal comes up, that's the moment to build the page.

Members are **out of scope** — granting a section to a member would require
making the access model additive, which v1 deliberately isn't. 171 of 186
users are managers, so the campaign reaches its audience without it.

## Testing

- Vitest on any new pure logic in the targeting filter (the eligible /
  optedOut / excluded partition, given users + overrides + opt-outs).
- Vitest on the enquiry form's payload builder (address + provider + note →
  RFQ title and description), so the RFQ text is provable without a DB.
- Live: submit an enquiry as a throwaway client user, confirm one RFQ appears
  with the right client and description, confirm a second submission is
  refused while the first is `new`, then delete both. Confirm a client with
  active lines still sees their data unchanged.
- Build + full suite green before push.

## Out of scope

Prices or packages on the page (SA connectivity pricing is address-dependent;
quoting blind would mislead); an admin bulk-access page; additive feature
access for members; automatic quoting from an enquiry; the campaign email copy
itself (drafted and approved separately at send time).
