# Quote Checkout with Recurring Billing — Design

**Date:** 2026-08-03
**Status:** Approved

## Purpose

Let a client pay a quote instead of merely accepting it. On a checkout-enabled
quote, the client's Accept button is replaced by **Checkout**, which takes one
combined card payment (once-off items + pro-rata for the partial first month)
through Paystack, then bills the full monthly amount automatically on the 1st
of every month thereafter.

Built for connectivity-style quotes (installation + monthly service). Paystack
is the complete billing record for these charges — nothing writes to Xero
(the portal's Xero integration stays read-only; reconciliation happens against
the bank feed as with any card income).

## Decisions already made

- **Opt-in per quote.** Shawn marks a quote checkout-enabled explicitly;
  default remains Accept/Decline. No auto-detection from section types.
- **Pro-rata:** daily rate = monthly ex-VAT ÷ actual days in that month,
  charged from **acceptance date + 3 days** (installation grace) to month-end.
  If the grace period crosses month-end, pro-rata is zero and the first
  charge is the full amount on the coming 1st.
- **We hold the authorization, we schedule the charges.** Paystack's
  Subscriptions/Plans API is deliberately NOT used — it bills on an interval
  from signup date and cannot align to calendar-month 1sts, and its retry
  policy can't be shaped to ours. We store the reusable card authorization
  from the initial checkout and charge it ourselves via
  `POST /transaction/charge_authorization`.
- **Failed charges:** retry on day 1 / day 3 / day 5. After three failures,
  stop, email Shawn once, email the client once (with a link to pay and
  re-capture their card). **Never auto-suspend service.**
- **Cancellation is staff-only**, from the admin quote page.
- **VAT** is applied once on the combined initial total; monthly charges carry
  their own VAT. Cents-integer money everywhere (matches the whole app).
- **Runs on Vercel Cron** — daily, server-side, independent of any laptop.
  The existing `vercel.json` crons and `CRON_SECRET` bearer pattern are
  extended, not duplicated.

## Data model

### `quotes` (new column)

```sql
alter table public.quotes add column checkout_enabled boolean not null default false;
```

### `quote_subscriptions` — one row per quote that has been through checkout

```sql
create table public.quote_subscriptions (
  id                          uuid primary key default gen_random_uuid(),
  quote_id                    uuid not null references public.quotes(id) on delete cascade,
  client_id                   uuid not null references public.clients(id) on delete cascade,
  paystack_authorization_code text,          -- set when initial charge succeeds
  paystack_customer_code      text,
  monthly_amount_cents        int not null,  -- ex VAT
  vat_cents                   int not null,  -- VAT on the monthly amount
  status                      text not null default 'pending_payment'
    check (status in ('pending_payment','active','cancelled','failed')),
  next_charge_date            date,          -- always a 1st once active
  created_at                  timestamptz not null default now(),
  activated_at                timestamptz,
  cancelled_at                timestamptz,
  cancelled_by                uuid references public.profiles(id) on delete set null
);
create unique index quote_subscriptions_quote_idx on public.quote_subscriptions (quote_id);
```

`status` meanings: `pending_payment` = checkout started, initial charge not
confirmed; `active` = billing monthly; `failed` = three retries exhausted,
awaiting human action (card update or cancellation); `cancelled` = terminal.

### `quote_subscription_charges` — every charge attempt, initial and recurring

```sql
create table public.quote_subscription_charges (
  id                 uuid primary key default gen_random_uuid(),
  subscription_id    uuid not null references public.quote_subscriptions(id) on delete cascade,
  charge_type        text not null check (charge_type in ('initial','recurring')),
  billing_period     date not null,   -- the month this charge is FOR (always a 1st);
                                      -- for 'initial', the acceptance month
  amount_cents       int not null,    -- ex VAT
  vat_cents          int not null,
  paystack_reference text not null unique,
  status             text not null default 'pending'
    check (status in ('pending','success','failed')),
  attempt_number     int not null default 1,
  failure_reason     text,
  created_at         timestamptz not null default now(),
  charged_at         timestamptz
);
create index quote_subscription_charges_sub_idx
  on public.quote_subscription_charges (subscription_id, billing_period);

-- One SUCCESS per month per subscription — failed attempts may repeat.
-- This partial index is the structural guarantee against double-billing:
-- a cron that fires twice cannot create a second successful charge row.
create unique index quote_subscription_charges_period_success_idx
  on public.quote_subscription_charges (subscription_id, billing_period)
  where status = 'success';
```

**Paystack reference convention:** `qs-<subscription_id>-<yyyymm>-a<attempt>`
— deterministic and unique per attempt, so retries can never collide and any
reference is traceable by eye in the Paystack dashboard.

### RLS

Same shape as every client/staff table in the schema: `rocking_staff` full
access on both tables; `client_manager` may `select` their own client's rows
(status, next charge date, charge history) and never write.

## Flows

### Enabling checkout

`checkout_enabled` is set when the quote is created/sent (script flag and/or
admin toggle). On the client quote page, when true and status is `sent`, the
Accept/Decline/Request-changes buttons are replaced by a single **Checkout**
button. (Request-changes can remain — it doesn't conflict.)

### Client checkout

1. Server action computes, using the quote's stored totals:
   - once-off: sum of non-monthly sections (ex VAT);
   - pro-rata: `monthly_ex_vat ÷ days_in_current_month × billable_days`,
     where `billable_days` = days from (today + 3) through month-end,
     clamped to ≥ 0; rounded to the nearest cent;
   - VAT at the quote's `vatPercent` on the combined ex-VAT total.
2. Insert `quote_subscriptions` row (`pending_payment`, monthly amount
   captured now) — hold-first, mirroring `support_bookings`.
3. `initializeTransaction` extended to accept `channels: ["card"]` — forced
   for these checkouts so the completed payment yields a **reusable**
   authorization. (EFT/other channels produce authorizations that cannot be
   charged again; card-only is what makes recurring possible.)
4. Checkout page shows, before redirecting to Paystack: the once-off amount,
   the pro-rata amount **with the exact date range it covers**, and plain
   language that *R X incl VAT will be billed automatically on the 1st of
   every month until cancelled*. Disclosure lives on the page, not in terms.
5. Client pays on Paystack's hosted page; redirect returns them to the quote.

### Confirming the initial charge

Webhook (`charge.success`) — extended from the existing handler, same
signature check, same always-200 discipline. For a `qs-` reference:

1. Atomic flip `pending_payment → active` (losing duplicate delivery no-ops).
2. Store `authorization.authorization_code` + `customer.customer_code` from
   the event payload.
3. Set `next_charge_date` = first day of the next month.
4. Mark the `initial` charge row `success`.
5. Flip the quote itself to `accepted` (a paid checkout IS acceptance) and
   record a `quote_events` row so the audit trail shows how it was accepted.
6. Notify Shawn (existing quote-decision email path, reworded for "paid").

A server-side `verifyTransaction` fallback runs when the client lands back on
the quote page, exactly as bookings do — webhook remains primary truth.

### The recurring engine — daily Vercel Cron

New route `app/api/jobs/subscription-charges/route.ts`, guarded by
`CRON_SECRET` (GET + POST, identical handler — same convention as
`jobs/digest`). Added to `vercel.json` daily at `15 4 * * *` (06:15 SAST).

Each run, for every `active` subscription:

1. **Due today?** `next_charge_date ≤ today` and no `success` row for that
   `billing_period` → create attempt-1 `pending` row, charge.
2. **Retrying?** Latest row for the period is `failed`, `attempt_number < 3`,
   and ≥ 2 days since that attempt → next attempt row, charge.
3. **Exhausted?** Three `failed` attempts → flip subscription to `failed`,
   email Shawn once, email the client once with a payment link (below).
   The cron skips `failed` subscriptions thereafter.

Charging = `POST /transaction/charge_authorization` with the stored
authorization code, email, amount (incl VAT, cents), and the deterministic
reference. The response is **synchronous** — the cron updates the charge row
and `next_charge_date` (on success: first of the following month) directly
from it. The webhook also fires for these charges and hits the same
idempotent confirm path as a harmless backup.

`charge_authorization` failures are recorded with Paystack's
`gateway_response` as `failure_reason`.

### Card update / arrears recovery

No separate "update card" UI. The failure email links to a page that re-runs
hosted checkout (card-only) for exactly what is owed. Payment through it:

- marks the outstanding period(s) paid,
- captures a fresh authorization code, saved over the old one,
- flips the subscription `failed → active` and resumes the normal schedule.

### Cancellation

Staff-only card on the admin quote page: **Stop recurring billing** →
`status = 'cancelled'`, stamps `cancelled_at`/`cancelled_by`, records a
`quote_events` note. The cron skips anything not `active`. No client-facing
cancel in v1.

## Admin & client UI

**Admin quote page** — new sidebar card (same Card/CardHeader pattern as
Approve & Send / Decision), shown when a subscription exists:

- status pill, monthly amount, next charge date;
- full charge history table: period, attempt, amount, result, date;
- **Stop recurring billing** button;
- **Charge now** button — manually triggers the charge path for a `failed`
  or due subscription, so Shawn is never waiting on tomorrow's cron after
  resolving something with a client directly.

**Client quote page** — once active, the decided-banner area shows the
subscription state: active since date, monthly amount incl VAT, next billing
date. Client managers see it read-only.

## Error handling summary

| Failure | Behaviour |
|---|---|
| Cron fires twice in a day | Partial unique index makes a second success structurally impossible; retry spacing check makes duplicate failed attempts a no-op |
| Webhook duplicate delivery | Atomic status-flip no-ops, as bookings today |
| Paystack down during cron | Attempt rows stay `pending`/`failed`; next run retries; nothing lost |
| Initial checkout abandoned | Subscription stays `pending_payment`; quote stays `sent`; client can retry Checkout (new reference, same row) |
| Charge fails 3× | Subscription `failed`; one email each to Shawn and client; no auto-suspend |
| Card expired | Same as failed — recovery via the arrears checkout link |

## Testing

**Unit (pure functions, injected clock)** — new `lib/subscriptions/` module
holding pro-rata and scheduling logic, tested like `lib/quotes/doc.test.ts`:

- pro-rata: mid-month signup; signup where +3 days crosses month-end (→ 0);
  February vs a 31-day month (actual-days divisor); signup on the 1st;
  rounding to cents.
- scheduling: due-today detection; day-1/3/5 retry spacing; stop after 3;
  `failed`/`cancelled` subscriptions skipped; billing_period uniqueness.

**End-to-end (Paystack test mode, `PAYSTACK_USE_TEST=1`)**:

- successful checkout → webhook → `active`, authorization stored, initial
  charge logged, quote `accepted`;
- test-decline card → three retries on schedule → `failed` + both emails;
- arrears link → payment → re-activated with new authorization;
- cancelled subscription untouched by the cron;
- cron double-invocation produces no second charge.

## Out of scope (v1)

- **Changing the monthly amount mid-term** — locked at checkout. A price
  change = cancel + new quote + new checkout.
- **Refunds** — manual, in the Paystack dashboard.
- **Client self-serve cancellation.**
- **Xero invoice creation** — Paystack is the record; revisit as its own
  design if wanted later.
- Multiple subscriptions per client need nothing extra (they're per-quote).
