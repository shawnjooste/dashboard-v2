# Mobile Client Portal — Design

**Date:** 2026-08-05
**Status:** Approved in conversation (Shawn) — Approach A.

## Purpose

The client portal is unusable on a phone. Measured at 375px on the live dev
server: the nav strip alone fills the entire first viewport — logo, a wrapped
"Account home", and a horizontally-scrolling row of **nine** full-size links
(Account home, Support, Devices, Network, Microsoft 365, Services, Quotes,
Team, Communications) plus Sign out. A client landing on `/support` sees a wall
of navigation and zero content without scrolling.

This is the "make it usable now" step toward a real mobile app later — not the
app itself.

## Scope decision

On mobile a signed-in client gets **two things only: Tickets and Status.**

- "Status" = the existing `/status` service-status/incident page.
- The other seven sections are **hard-hidden** from mobile navigation
  (Shawn's explicit call). Their pages still render if reached by direct URL —
  nothing is blocked, they're simply not offered on a phone.
- Desktop (`md` and up) is **completely unchanged**. Every change in this spec
  is behind a mobile-only breakpoint.

## Approach

Rejected: compacting the existing nav strip (leaves a website with a smaller
menu, doesn't fix the content pages) and a parallel `/m/*` route tree
(duplicates every screen, doubles maintenance forever).

Chosen: **app-style shell + focused passes on the four screens that matter.**
Bottom tabs are the strongest "this is an app" signal and make an eventual
native wrapper trivial.

## 1. The shell (`components/AppShell.tsx`)

Below `md`:
- The sidebar `<aside>` is hidden entirely (currently it renders as the
  scrolling strip — that strip is the bug).
- A **slim top bar**: logo (taps to `/support` — on mobile that *is* home),
  account name, sign out.
- A **fixed bottom tab bar** with exactly two tabs: **Tickets** (`/support`)
  and **Status** (`/status`). Icon + label, minimum 44px touch targets, clear
  active state driven by the same `isActive` prefix rules `Sidebar` already
  uses (so `/support/123` keeps Tickets lit).
- Main content gets bottom padding equal to the bar height plus
  `env(safe-area-inset-bottom)`, so the last row is never hidden behind the
  bar or the iPhone home indicator.

At `md`+: sidebar renders exactly as today, bottom bar and mobile top bar are
hidden. The impersonation and other existing banners are untouched.

The two mobile tabs are defined in `lib/nav.ts` as a `MOBILE_NAV` constant
next to the existing `NAV`, so "what a phone shows" is data in one place
rather than markup scattered across the shell.

## 2. Tickets — three screens

**`/support` (list)** — `app/(app)/support/page.tsx`
- The long "Support & escalation" preamble collapses into a
  "How support works" `<details>` disclosure on mobile so the tickets are the
  first thing on screen. It stays expanded/inline on desktop.
- Ticket rows become tappable cards below `md`: subject on its own line,
  status pill and date beneath, `#number` and preview truncated to one line.
  The "Book support" affordance (currently a hover-revealed pill) moves to a
  visible, tappable element on mobile — hover doesn't exist on touch.

**`/support/new` (form)** — single column; **all inputs ≥16px font** (below
16px, iOS Safari zooms the viewport on focus, which is the classic reason a
form "feels broken" on a phone); full-width submit.

**`/support/[id]` (thread)** — messages stack full-width, sender/date meta on
its own line, reply box full-width with a clearly tappable send button.

## 3. Status (`/status`, `components/status/StatusView.tsx`)

Lightest touch — it's already list-shaped. Stacking, type scale, and touch
targets only. No behaviour change.

## 4. Explicitly out of scope

- The entire admin surface (`(admin)`) — it's a desktop tool; staff on phones
  is a separate conversation.
- Any data, query, permission, or RLS change. This is presentation only.
- PWA manifest / installability / push — that belongs to the real mobile-app
  conversation, not "make it usable now".
- The seven hidden sections' own pages (they keep their current desktop
  layout).
- Landing-route changes: `/` still renders Account home if reached; it is
  simply not offered in mobile nav.

## Verification

This is layout work — unit tests would be theatre and are deliberately not
added. Verification is:

1. **Real screenshots at 375×812** of all four screens (`/support`,
   `/support/new`, a ticket thread, `/status`), signed in as the JoosteCo
   test client, before and after.
2. Confirm at 375px: no horizontal page scroll, no content hidden behind the
   bottom bar, both tabs reachable and correctly lit, tap targets ≥44px.
3. **Desktop regression check** — screenshot at 1280px confirming the sidebar
   and layout are pixel-identical to today.
4. `npm test` and `npm run build` green (proving nothing else regressed).
