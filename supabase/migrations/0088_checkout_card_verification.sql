-- Card-verification checkout: quotes where the client is already paid up for
-- the current month, so accepting must capture a reusable card authorization
-- WITHOUT taking a real payment, and start billing on the 1st of next month.
--
-- Paystack rejects a zero-amount transaction ("Invalid Amount Sent"), and a
-- reusable authorization can only come from a completed transaction — so we
-- charge the R1 minimum purely to tokenize the card and refund it immediately.
-- The charge is recorded with its own charge_type so it is never mistaken for
-- revenue, never receipted, and never satisfies a billing period.

alter table public.quotes
  add column if not exists billing_starts_next_month boolean not null default false;

comment on column public.quotes.billing_starts_next_month is
  'Checkout captures the card via a refunded R1 verification instead of charging once-off + pro-rata; recurring billing starts on the 1st of the following month.';

alter table public.quote_subscription_charges
  drop constraint if exists quote_subscription_charges_charge_type_check;

alter table public.quote_subscription_charges
  add constraint quote_subscription_charges_charge_type_check
  check (charge_type in ('initial', 'recurring', 'verification'));

alter table public.quote_subscription_charges
  add column if not exists refunded_at timestamptz;

comment on column public.quote_subscription_charges.refunded_at is
  'Set when a verification charge has been refunded to the client.';

-- The one-success-per-period index must ignore verification charges: they are
-- stamped with the CURRENT month only to keep references unique, and must
-- never make the cron think that month was collected.
drop index if exists quote_subscription_charges_period_success_idx;

create unique index quote_subscription_charges_period_success_idx
  on public.quote_subscription_charges (subscription_id, billing_period)
  where status = 'success' and charge_type <> 'verification';
