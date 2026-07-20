# Support Bookings (Phase 2) — Design

**Date:** 2026-07-16
**Status:** Approved in conversation (Shawn). Phase 2 of the support-packages
programme (`2026-07-14-support-packages-design.md`).

## Purpose

Clients not covered for hands-on help can buy it directly from the portal:
pick a service, pick a slot, **pay by card upfront via Paystack**, and the
booking is confirmed. This is the gate's paid lane — and the machinery Phase 3
will point Business Care clients at when their hours run out.

## Decisions

- **Services & prices (ex VAT, editable data):** Remote support session
  **R1,000/hr**; Onsite callout **R1,250/hr**. VAT 15% added at checkout.
- **Slots:** weekdays only, **08:00–17:00 SAST**, 1-hour slots (9/day), one
  booking per slot across the whole team (single capacity, v1).
- **Payment:** Paystack hosted checkout, card upfront. The **webhook is the
  source of truth** — a booking confirms only after a signature-verified
  `charge.success` whose amount matches. The browser redirect is cosmetic.
- **Unpaid holds expire:** a `pending_payment` booking holds its slot for
  30 minutes, then lapses (computed at read time — no cron).
- **Refunds/reschedules are manual** — no self-serve. Copy says "reply to your
  confirmation email or contact support to reschedule."
- **Credits are deferred** to a later phase (Shawn, 2026-07-16): a booked hour
  bills as an hour; true-up for under-used sessions is manual goodwill until
  the credit ledger phase. Design there = prepay − actual×rate at 15-min
  granularity becomes credit auto-applied at next checkout; NOT in this build.
- Paystack keys live in `dashboard-v2/.env.local` (`PAYSTACK_SECRET_KEY`,
  `PAYSTACK_TEST_SECRET_KEY`; both verified authenticating) and the live key
  must be added to Vercel env before deploy. Keys were rotated after an
  accidental exposure; never print or commit them.

## Data model

Migration (next number at build time):

**`support_services`** — `id uuid pk`, `key text unique` (`remote` | `onsite`),
`name text`, `price_cents int` (ex VAT; R1,000 → 100000), `active bool default
true`. Seeded with the two services. Prices edited on the packages admin page.

**`support_bookings`** — `id uuid pk`, `client_id fk`, `service_id fk`,
`slot_start timestamptz`, `slot_end timestamptz`, `amount_cents int` (ex-VAT
snapshot at booking time), `vat_cents int`, `paystack_reference text unique`,
`status text check in ('pending_payment','paid','completed','cancelled')`,
`booked_by uuid references profiles`, `freescout_number int null`,
`note text null` ("what do you need help with"), `created_at`,
`paid_at timestamptz null`.

RLS: staff full access; a client's users select/insert their own
(`client_id = current_client_id()`); status transitions and cancellations are
staff/server-only (updates via service client in actions — no client UPDATE
policy).

## Slot availability

Pure helper (`vitest`-covered): given a date range, business rules (Mon–Fri,
08:00–17:00 SAST, 60-min slots) and existing bookings, return open slots. A
slot is taken if a booking overlaps it with status `paid`/`completed`, or
`pending_payment` **younger than 30 minutes**. SAST is fixed UTC+2 (no DST) —
slots computed in UTC with the +2 offset, displayed as local times.

## Payment flow

1. Client picks service + slot + note → server action `createBooking`:
   re-checks the slot is still free, inserts `pending_payment` with a
   generated reference (`bk_<uuid>`), calls Paystack `POST /transaction/initialize`
   (amount = (price+VAT) in cents — Paystack ZAR unit is cents, email =
   client user's email, reference, `callback_url` =
   `https://portal.rocking.one/support/bookings/{id}`), returns the
   `authorization_url` → client is redirected to Paystack.
2. **Webhook** `app/api/paystack/webhook/route.ts`: verifies
   `x-paystack-signature` (HMAC-SHA512 of raw body with the secret key),
   handles `charge.success`: looks up the booking by reference, checks the
   paid amount ≥ expected total, flips to `paid` + `paid_at`, creates the
   FreeScout ticket (tagged `booking`, `tier:<key>`; subject
   "Paid {service}: {date} {time} — {client}"), stores the ticket number,
   sends the confirmation email (Resend, established template, reply-to
   support@). Idempotent: an already-`paid` booking is a no-op.
3. The booking page (`/support/bookings/[id]`) shows live status; on return
   from Paystack, if the webhook hasn't landed yet, the page calls Paystack
   `GET /transaction/verify/{reference}` server-side as a fallback
   confirmation path (same amount check, same transition, idempotent with 2).
4. Paystack dashboard: set Live Webhook URL to
   `https://portal.rocking.one/api/paystack/webhook` (Shawn pastes it when
   the endpoint ships). Test mode uses the test secret + Paystack test cards.

Env selection: `PAYSTACK_SECRET_KEY` in production; local dev/manual testing
uses `PAYSTACK_TEST_SECRET_KEY` via a `PAYSTACK_USE_TEST=1` switch.

## Client UI

- `/support` gains a **"Book a session"** card (all tiers; Phase 3 will make
  it the exhausted-hours path): service picker with prices incl VAT shown,
  week-view slot picker (next 10 business days), note field.
- `/support/bookings/[id]`: status page — pending (with "complete your
  payment" link), confirmed (slot, reference, what happens next, reschedule
  copy), cancelled.
- A "Your bookings" list on `/support` when any exist.
- Members and managers can both book (any portal user of the client).

## Admin UI

- Bookings list at `/admin/support-packages` (new card): upcoming + recent,
  status, client, service, slot, amount, FreeScout link; staff actions:
  mark completed, cancel (manual-refund reminder copy).
- Prices editable alongside the package rows (support_services form).

## Testing

- Vitest: slot generation (weekends excluded, taken/pending-hold logic,
  30-min lapse), money math (VAT, cents), webhook signature verification
  (known HMAC vector), reference generation.
- Manual (test keys): full checkout with Paystack test card; webhook via
  Paystack test webhook + local verify fallback; slot contention (two
  pending holds); RLS spot-checks (client sees own bookings only).

## Out of scope

Credits/true-up ledger (next phase), self-serve refunds/reschedules,
multi-technician calendars, variable durations, Care-hours integration
(Phase 3), Crisp (Phase 4).
