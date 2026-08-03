-- Quote checkout with recurring billing. A checkout-enabled quote is paid
-- (once-off + pro-rata) instead of merely accepted; the card authorization
-- captured at checkout is then charged on the 1st of every month by a daily
-- cron. Spec: docs/superpowers/specs/2026-08-03-quote-checkout-recurring-design.md

alter table public.quotes add column checkout_enabled boolean not null default false;

-- One subscription per quote that has been through checkout.
create table public.quote_subscriptions (
  id                          uuid primary key default gen_random_uuid(),
  quote_id                    uuid not null references public.quotes(id) on delete cascade,
  client_id                   uuid not null references public.clients(id) on delete cascade,
  paystack_authorization_code text,          -- set when the initial charge succeeds
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
create index quote_subscriptions_client_idx on public.quote_subscriptions (client_id);

-- Every charge attempt, initial and recurring. billing_period = the month the
-- charge is FOR (always a 1st; the acceptance month for 'initial').
create table public.quote_subscription_charges (
  id                 uuid primary key default gen_random_uuid(),
  subscription_id    uuid not null references public.quote_subscriptions(id) on delete cascade,
  charge_type        text not null check (charge_type in ('initial','recurring')),
  billing_period     date not null,
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

-- One SUCCESS per month per subscription — failed attempts may repeat. This
-- partial index is the structural guarantee against double-billing: a cron
-- that fires twice cannot create a second successful charge row.
create unique index quote_subscription_charges_period_success_idx
  on public.quote_subscription_charges (subscription_id, billing_period)
  where status = 'success';

-- RLS: staff full access; a client manager may READ their own client's rows.
alter table public.quote_subscriptions enable row level security;
alter table public.quote_subscription_charges enable row level security;

create policy quote_subscriptions_staff on public.quote_subscriptions
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy quote_subscriptions_manager_select on public.quote_subscriptions
  for select using (
    public.current_user_role() = 'client_manager'
    and client_id = public.current_client_id()
  );

create policy quote_subscription_charges_staff on public.quote_subscription_charges
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy quote_subscription_charges_manager_select on public.quote_subscription_charges
  for select using (
    public.current_user_role() = 'client_manager'
    and exists (
      select 1 from public.quote_subscriptions s
      where s.id = subscription_id and s.client_id = public.current_client_id()
    )
  );
