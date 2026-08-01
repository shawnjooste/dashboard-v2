-- Services are no longer all one hour: remote support is a 30-minute session
-- (matching Tim's Calendly event type) at R500 ex VAT, onsite stays 60 min.
-- Duration drives slot_end and the clash check, so it has to be data.
alter table public.support_services
  add column duration_minutes int not null default 60 check (duration_minutes > 0);

update public.support_services
   set duration_minutes = 30,
       price_cents = 50000
 where key = 'remote';
