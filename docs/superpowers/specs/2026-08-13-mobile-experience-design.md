# Mobile experience — design

**Date:** 2026-08-13
**Status:** Approved
**Scope:** Project 1 of 2. Project 2 (Expo app) gets its own spec, written after this ships.

## Why

A client was sent a quote, opened the link on their phone, and could not read it. That
single report exposed three independent defects, only one of which is styling.

The previous mobile pass (shipped 2026-08-12) scoped mobile to two sections — tickets and
status — and hid everything else from mobile navigation. That was the wrong axis. Clients
do not arrive at the portal through navigation; they arrive through links we email them.
Choosing *sections* guarantees that anything emailed outside those sections dead-ends.

The axis is therefore: **if we email a link, it must open properly on a phone.**

## The three defects

**1. Sign-in discards the destination.** `app/(app)/layout.tsx` does a bare
`redirect("/login")`. There is no `next` capture anywhere in the auth path, so the
`/quotes/{id}` the client was trying to reach is lost. They sign in and land on the default
page. This affects desktop equally; it is merely survivable there, because the sidebar
offers a way back.

**2. Mobile navigation has no way back.** `MOBILE_NAV` in `lib/nav.ts` lists two items.
On desktop a lost user finds "Quotes" in the sidebar. On a phone there is no path to a
quote at all.

**3. The quote document is a print artifact.** `components/QuoteDocument.module.css` is a
literal A4 page: `width: 210mm`, `padding: 18mm` per side, `table-layout: fixed` reserving
48px + 110px + 120px for qty/unit/total. On a 375px viewport the padding alone consumes
~136px, leaving ~239px of content width for 278px of hard-coded numeric columns. The
description column collapses.

## Scope: the emailed destinations

Derived from every `${APP_URL}` link in `lib/`, `app/`, and `scripts/`, excluding
`/admin/*` (staff-only):

| Destination | Emails | State | Work |
|---|---|---|---|
| `/quotes/{id}` | 5 | A4-locked | Reflow, price header, sticky actions |
| `/support/bookings/{id}` | 2 | Unaudited | Light pass |
| `/` (Home) | 2 | Heavy dashboard | `NeedsYou`; heavy cards desktop-only |
| `/status` | 2 | Done | — |
| `/login`, `/auth/confirm` | 3 | No pass | `next` round-trip, 16px inputs |
| `/agreements/{id}` | 1 | Body already fine | 16px name input, sticky sign CTA |
| `/quotes/{id}/pay` | 1 | Summary + button | Light pass |
| `/communications` | 1 | Unaudited | Light pass |

**Breakpoint.** Mobile means `< 768px` (Tailwind's `md:` boundary), matching the existing
codebase convention. Verification targets 375px as the narrowest realistic device.

**"Light pass"** means, specifically: no horizontal overflow at 375px, all tap targets at
least 44px, all text inputs at least 16px (below that iOS zooms the viewport on focus), and
long strings wrapped rather than truncated. It does not mean a layout redesign. If an
unaudited page turns out to need one, that is raised rather than absorbed silently.

Two findings that reduced scope during design, both verified in code:

- `components/AgreementBody.tsx` is `max-w-[68ch]` rendered markdown — no table, no fixed
  width. It already reads correctly on a phone. The only defect is the 14px name input in
  `SignBlock.tsx`, which triggers iOS viewport zoom on focus.
- `app/(app)/quotes/[id]/pay/page.tsx` is a summary and one button. Paystack hosts the card
  form on their own mobile-optimised page; we never render card fields.

**The A4 problem is unique to the quote document.**

## 1. Deep links survive sign-in

The foundation. Everything else is decoration if a link still lands on the wrong page.
This fixes desktop as well as mobile.

- `middleware.ts` forwards the query string alongside the existing `x-pathname` header, so
  `/quotes/abc?ref=xyz` round-trips intact rather than dropping the Paystack reference.
- `app/(app)/layout.tsx` redirects to `/login?next=<encoded path+search>`.
- A new `safeNext()` in `lib/auth/routing.ts`, extracted from the open-redirect guard that
  already exists at `app/auth/confirm/route.ts:17`. Login and the magic-link handler share
  one tested function rather than two copies that can drift.
- The login form carries `next` through the OTP round trip as a hidden field.
  `verifyCode` ends at `safeNext(next) ?? POST_LOGIN_PATH`.
- Staff following a client deep link continue to go through `staffRedirectFor`. Unchanged.

`safeNext()` accepts only relative, single-slash paths. It is the sole guard against an
open redirect on a URL we put in emails, so it is specified and tested adversarially.

## 2. Navigation reaches everything

`MOBILE_NAV`'s two hard-coded items are deleted. The bottom tab bar becomes:

**Home · Tickets · Status · More**

"More" is a full-page list generated from `NAV[role]` filtered by the `allowedHrefs` the
layout already computes. This is deliberate: the mobile menu derives from the same source
as the desktop sidebar, so it automatically respects per-user feature overrides, the
`billingEnabled` gate, and the `connectivityEnabled` gate. It cannot drift from desktop,
and it cannot expose a section the user is not entitled to.

Nothing is hard-hidden from mobile.

## 3. Home becomes "needs you"

Home shows what is waiting on *this user*, rather than a directory of what exists. A new
`NeedsYou` component reads from existing view modules:

| Item | Source | Condition |
|---|---|---|
| Quote awaiting decision | `lib/views/quotes` | `status = 'sent'`, not expired |
| Agreement to sign | `lib/views/agreements` | unsigned |
| Payment problem | `lib/views/subscriptions` | `status = 'failed'` |
| Open tickets | `lib/freescout` | active / pending |
| Active incident | `lib/views/status` | already loaded in the layout |

Empty state — nothing outstanding — reads as reassurance, not as an error.

It renders at the top of Home on **both** mobile and desktop. It is an improvement on both,
and one component is cheaper to maintain than two.

**Known limitation, accepted for v1:** the existing heavy cards (device health, M365,
billing, sparklines) are hidden below `md:` via CSS. Server components cannot branch on
viewport, so those queries still execute on mobile. Page weight drops; server cost does
not. This is no worse than today. If mobile Home proves slow, the fix is splitting the
route — not guessing at it now.

## 4. How the quote reflows

`QuoteDocument.module.css` gains a `@media (max-width: 767px)` block:

- Page padding drops from 18mm to 14px.
- `colgroup` widths are neutralised.
- `thead` is hidden.
- `table`, `tr`, `td` become `display: block`, so each line item renders as a card:
  description on its own line, then `qty × unit` with the total right-aligned.

`QuoteDocument.tsx` gains `data-label` attributes on the numeric cells so no value loses
its meaning once the header row is gone.

Above the document sits a compact header (total incl VAT, valid-until date). Below it,
`QuoteActions` becomes a sticky bottom bar on mobile so Approve/Decline is always reachable
without scrolling to the end of a long quote.

**`@media print` re-asserts table display.** The A4 output must remain byte-identical —
this component is what clients receive as a PDF. This is a hard requirement, verified by
diffing a generated PDF before and after.

Rejected alternative: a separate mobile-only presentation of the quote. It reads better in
isolation, but it means maintaining two renderings of the quote format. The first time
someone adds a comparison table or section subtitle to a quote, the phone view drops it
silently. Reflowing the one component avoids that class of bug entirely.

## Testing

- **Unit — `safeNext()`**, adversarially: `//evil.com`, `https://evil.com`, `/\evil`,
  `javascript:alert(1)`, a valid `/quotes/x?a=b`, and `undefined`. This guards an open
  redirect on a URL we email, so it gets attack cases, not happy paths.
- **Unit — needs-you selection**, as a pure function over rows, following the existing
  pattern in `lib/security/severity-map.mjs`.
- **Browser at 375px** — all eight destinations, signed in as a real client, reached by
  clicking an emailed-style link while signed out (the full journey, not the page in
  isolation).
- **Desktop regression at 1280px** — the sidebar and existing pages must not move.
- **Print** — generate a quote PDF before and after; diff.

## What hands off to Expo (Project 2)

Recorded here so the decisions made above are understood as load-bearing, not as
throwaway bridge work:

- The tab structure becomes Expo Router's tab layout.
- The needs-you list becomes both the app's home screen and the payload set for push
  notifications. One decision serves both.
- Client reads already go through the RLS Supabase client, and sensitive writes already
  exist as `SECURITY DEFINER` RPCs (`sign_agreement`, `set_device_disposition`,
  `set_my_name`). `supabase-js` runs natively in Expo, so most data needs no new API.
- The genuine prerequisite: quote accept/reject with its event trail and emails, Paystack
  initiation, and FreeScout ticket creation currently live in server actions, which native
  cannot call. These become RPCs or Edge Functions. That is Project 2's first task.
- Auth is already 6-digit OTP, which is the simplest possible native sign-in — no deep-link
  plumbing or OAuth redirect handling required.

## Out of scope

- Any change to desktop layout beyond the `NeedsYou` block on Home.
- The remaining client routes (devices, network, M365, team, billing detail, services,
  quotes list, agreements list). They stay reachable via More and receive no layout work
  in this project.
- The Expo app itself.
- Push notifications.
