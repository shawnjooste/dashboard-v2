# Calendly Availability & Booking — Design

**Date:** 2026-07-30
**Status:** Approved in conversation (Shawn). Extends the support-bookings
system (`2026-07-16-support-bookings-design.md`); added to the programme after
Tim flagged he can't block time against the static slot grid.

## Purpose

The portal currently sells a fictional calendar: every weekday hour
08:00–17:00, whether or not Tim is free. Calendly — watching Tim's *real*
connected calendar — becomes both the availability oracle and the booking
writer. Tim blocks time the way he already works (his own calendar); the
portal automatically stops selling those hours.

## Decisions

- **Calendly owns the working-hours boundary.** The portal's static
  08:00–17:00 grid disappears as the primary source. Tim manages bookable
  hours, lunch blocks, leave, and buffers in Calendly.
- **Per-person tokens, no organization.** Shawn explicitly does not want Tim
  in his Calendly org (seat pricing). Tokens follow the existing convention
  (see `lib/calendly.ts` and the calendly-per-person-tokens memory):
  `CALENDLY_API_TOKEN_TIM` (support bookings), `CALENDLY_API_TOKEN_SHAWN`
  (quote links, untouched). Both verified authenticating; both in Vercel.
- **Booking via Calendly's Scheduling API** (Create Event Invitee): on
  payment confirmation the portal books the meeting into Tim's Calendly
  programmatically. Calendly then handles calendar invites to Tim AND the
  client, reminders, and busy-blocking. Requires Tim on a **paid plan**
  (planned anyway). No .ics plumbing of our own.
- **Availability via Calendly's event-type available-times**, not manual
  busy-time math: one call returns bookable slots with working hours, real
  calendar, existing bookings, and buffers already applied. Travel buffers
  for onsites are configured ON the Calendly event type — the portal never
  models buffers.
- **Two event types on Tim's account map to our two services** ("Remote
  support session" 60 min; "Onsite callout" 60 min + buffers). Created
  manually once; URIs stored as data.
- **Graceful degradation:** any Calendly failure at read time falls back to
  the existing internal grid + internal double-book guard. Bookings never go
  down because Calendly hiccuped. Calendly write failure after payment never
  loses the booking (same best-effort rule as FreeScout/email side-effects).
- **The portal remains the money/status record.** Calendly never touches
  Paystack, prices, or the booking status machine.

## Prerequisites (Tim's account — before build verification)

1. Timezone → Africa/Johannesburg (currently America/New_York — would skew
   every slot by 6 hours).
2. Connect his real work calendar (busy-times probe currently returns zero
   external events — the connection is the whole point).
3. Upgrade to a paid Calendly plan (Scheduling API is paid-plan gated).
4. Create the two event types; give Shawn/portal their URIs (or we read them
   via `GET /event_types?user=` and store).

## Data model

Migration (next number at build time):

- `support_services` + `calendly_event_type_uri text null` — the mapping.
  Null = no Calendly for this service (falls back to internal grid).
- `support_bookings` + `calendly_event_uri text null` — the created event,
  for traceability and future cancellation sync.

No new tables. Service→event-type mapping is editable on the admin
Support-packages page next to prices (a URI/paste field, staff-only).

## Architecture

New `lib/calendly-availability.ts` (sibling of the quotes-focused
`lib/calendly.ts`, same conventions, token env `CALENDLY_API_TOKEN_TIM`
via a `SUPPORT_HOST_TOKEN_ENV` constant):

- `getCalendlySlots(eventTypeUri, days)` → `{ iso, label }[]` — wraps
  Calendly's available-times for the event type, normalized to the existing
  slot shape (SAST labels via the existing `slotLabel`). Calendly caps
  available-times queries at 7 days per call → two calls cover our 10-business-
  day window; confirm exact cap at build time and page accordingly.
- `createCalendlyBooking(eventTypeUri, startIso, invitee: { email, name },
  note)` → `{ eventUri } | null` — Create Event Invitee; null on any failure
  (best-effort, logged).

Changes to existing code:

- `getOpenSlots()` (lib/views/bookings.ts) becomes service-aware:
  `getOpenSlots(serviceId?)`. If the service has a `calendly_event_type_uri`,
  ask Calendly; on failure or no mapping, fall back to the current internal
  computation. The internal double-book guard (our own bookings subtract)
  applies in BOTH paths — belt and braces against Calendly lag.
- `BookSession` UI: slots load per selected service (small change — slots
  currently identical for both services; with Calendly they can differ, e.g.
  onsite buffers). Server component passes per-service slots or the client
  refetches via a server action on service change.
- `confirmBooking()` (lib/booking-confirm.ts): after the paid-flip, alongside
  FreeScout/email side-effects, call `createCalendlyBooking` with the client
  booker's email/name and the note; store `calendly_event_uri`. Failure logs
  and continues (Tim still learns via the FreeScout ticket; admin bookings
  page shows a "no calendar event" marker for manual follow-up).
- `cancelBooking()` action: if the booking has a `calendly_event_uri`,
  best-effort cancel it in Calendly too (`POST .../cancellation`), so Tim's
  calendar frees up.

## Error handling

- Calendly read errors → internal-grid fallback (log once, no user-visible
  error).
- Calendly write errors → booking stands; admin page marks the row "calendar
  event missing"; staff fix manually.
- Token invalid/missing → same as read error (fallback), plus console.warn,
  mirroring `createSingleUseBookingLink`'s fail-soft.
- Slot taken on Calendly's side between display and payment (rare — payment
  takes minutes): Create Event Invitee will reject; booking stands, marked
  "calendar event missing", staff reschedule with the client manually.
  (Accepted v1 risk; same class as today's slot-contention window.)

## Testing

- Vitest: response normalization (Calendly available-times JSON → slot
  shape), fallback selection logic (mapping present/absent, API ok/failing) —
  pure functions with fixture payloads.
- Live verification (needs Tim's prerequisites done): read available times
  reflecting a block Tim places in his calendar; create + cancel a real
  booking on his account end-to-end via a test payment (test-mode Paystack
  where possible).
- Regression: full existing booking flow with a service that has NO Calendly
  mapping (fallback path = today's behavior).

## Out of scope

- Per-engineer lanes (Shawn's remote vs Tim's onsite, etc.) — the per-person
  token convention and per-service event-type mapping are the ready seam;
  wiring a second host is a follow-up, not this build.
- Calendly webhooks (invitee.canceled sync back into the portal) — v1 relies
  on staff seeing cancellations in FreeScout/calendar; revisit with P3.
- Rescheduling flows (still manual per the bookings spec).
- Quote booking links (`lib/calendly.ts`) — untouched.
