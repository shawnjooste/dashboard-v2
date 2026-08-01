-- Care clients never touch Paystack: their sessions draw down included hours
-- and anything beyond is invoiced. Recording HOW a booking was settled keeps
-- the money story readable without inventing new statuses (the status machine
-- still means "is this slot live?", not "who paid").
alter table public.support_bookings
  add column payment_method text not null default 'paystack'
    check (payment_method in ('paystack','included','invoice'));
