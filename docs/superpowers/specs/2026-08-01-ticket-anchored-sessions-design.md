# Ticket-Anchored Sessions (Slice A) — Design

**Date:** 2026-08-01
**Status:** Approved in conversation (Shawn). Slice A of the ticket-centric
support rework; supersedes the standalone booking entry point built in
`2026-07-16-support-bookings-design.md`.

## Purpose

The ticket becomes the anchor for all support work. Today a booking creates a
*new* FreeScout ticket on payment, so a client with an open "Outlook keeps
crashing" ticket who books a session ends up with two threads about one
problem. After this slice, **every session belongs to a ticket** — either one
created in the same flow, or an existing one — and the portal notes that
ticket rather than spawning a duplicate.

## Programme decisions this sits inside

- **FreeScout stays the ticket store; the portal proxies it.** No mirror
  tables, no sync. The portal owns the time ledger, bookings, packages and
  hours — keyed to FreeScout ticket numbers.
- **Free ticketing stays open to everyone** (portal + email). Paid hands-on
  help is portal-only.
- **Crisp is chat only** — quick questions, nothing persisted, no tickets.
- **Care clients never touch Paystack** and overflow is invoiced rather than
  blocked — but that is **Slice C**, not this one. In Slice A every session is
  paid via Paystack regardless of tier (no client is on a paid tier yet, so
  this is currently theoretical).

## Scope of Slice A

**In:** bookings anchor to a ticket; the two entry points that create that
anchor; `confirmBooking` notes the anchored ticket instead of creating one;
the standalone "Book a session" card is removed.

**Out:** covered/tier-aware bookings (Slice C), the admin ticket workspace
(Slice B), the weekly time-logging nudge (Slice D), the public website ticket
form (parked).

## Data model

Migration (next free number at build time):

```sql
alter table public.support_bookings
  add column ticket_number int;
```

`ticket_number` is the FreeScout conversation the session belongs to, set
**at booking creation**. The existing `freescout_number` keeps its current
meaning — the ticket the confirmation was posted to — so historical bookings
stay readable; for new bookings the two will match. (Kept separate rather
than reused so a failed note-post is distinguishable from "no ticket".)

No RLS change: the existing client-insert policy already scopes by
`client_id`, and the action validates ticket ownership server-side.

## Flows

**A. New problem (from `/support`).** One primary "Get help" action opens a
form: subject + description, then *"How would you like this handled?"* —
either **Reply on the ticket** (free, the default) or a **session**
(Remote / Onsite, with the existing month picker inline).

- Ticket is created first, always. If the client picked a session, the
  booking is then created anchored to that ticket and they go to Paystack.
- If payment is abandoned, the ticket still exists and gets normal free
  support — losing the problem description because a card failed would be
  the worst outcome here.

**B. Existing ticket (from `/support/[id]`).** The ticket detail page gains
the same choice: reply as today, or attach a session to *this* ticket. The
booking note pre-fills from the ticket subject.

The ticket list keeps a quiet "Book support →" link on **open/pending rows
only** — with ~100 mostly-closed tickets per client, a control on every row
is noise.

## Server changes

- `createBooking` accepts `ticket_number`. When present it **verifies the
  ticket is visible to the caller** via the existing
  `getSupportScope()` + `canAccessConversation()` helpers before insert —
  a client must not anchor a booking to another client's ticket.
- New action `createTicketWithSession(formData)`: creates the ticket
  (existing `createTicket`), then either redirects to the ticket (free path)
  or calls `createBooking` with the new ticket number and redirects to
  Paystack.
- `confirmBooking`: if `ticket_number` is set, **post a note to that ticket**
  and reopen it when closed, instead of creating a new conversation. The note
  states service, slot, amount and reference. Falls back to today's
  create-a-ticket behaviour when `ticket_number` is null (older bookings).
  Still best-effort: payment is recorded regardless.
- `cancelBooking`: posts a cancellation note to the anchored ticket.

**Needs live verification at build time** (only `createTicket` and tagging
are proven so far): adding a note via `POST /conversations/{id}/threads`
with `type: "note"`, and reopening via `PUT /conversations/{id}` with
`status: "active"`. If either differs, adjust the client — the fallback is a
customer-visible reply rather than a note.

## UI changes

- `/support`: the standalone **Book a session** card is removed; a single
  "Get help" primary action replaces it. Bookings list stays.
- `/support/[id]`: adds the session-request action.
- `components/BookSession.tsx` becomes a reusable picker embedded in both
  flows rather than a standalone card — same tiles, same month picker.

## Testing

- Vitest on the pure parts: the "which entry point / which mode" branching
  helper, and ticket-ownership validation logic split out as a pure function.
- Manual: new ticket + session end to end (ticket exists, booking anchored,
  note posted on payment, no duplicate ticket); new ticket, free path; session
  from an existing closed ticket (reopens); abandoned payment (ticket
  survives, hold lapses); a client attempting to anchor to another client's
  ticket number is rejected.
