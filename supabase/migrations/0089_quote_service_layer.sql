-- Quote service layer: idempotent creation and per-client numbering.

alter table public.quotes
  add column if not exists idempotency_key text;

create unique index if not exists quotes_idempotency_key_idx
  on public.quotes (idempotency_key)
  where idempotency_key is not null;

comment on column public.quotes.idempotency_key is
  'Caller-supplied key; a repeat returns the original quote instead of creating a second.';

alter table public.clients
  add column if not exists quote_prefix text;

create unique index if not exists clients_quote_prefix_idx
  on public.clients (quote_prefix)
  where quote_prefix is not null;

create table if not exists public.quote_prefix_counters (
  prefix text primary key,
  last_n  int not null default 0
);
alter table public.quote_prefix_counters enable row level security;
-- no policies: only the security-definer function below and the service role touch it

create or replace function public.next_quote_number(p_prefix text)
returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into quote_prefix_counters (prefix, last_n) values (p_prefix, 1)
  on conflict (prefix) do update set last_n = quote_prefix_counters.last_n + 1
  returning last_n into n;
  return 'QU-' || p_prefix || '-' || lpad(n::text, 3, '0');
end $$;

revoke execute on function public.next_quote_number(text) from public, anon, authenticated;

-- Seed prefixes and counters from quotes already issued, so the first generated
-- number cannot collide with one a client already holds.
insert into public.quote_prefix_counters (prefix, last_n)
select substring(quote_number from 4 for 3) as prefix,
       max(substring(quote_number from 8)::int) as last_n
  from public.quotes
 where quote_number ~ '^QU-[A-Z]{3}-[0-9]{3}$'
 group by 1
on conflict (prefix) do update set last_n = greatest(quote_prefix_counters.last_n, excluded.last_n);

update public.clients c
   set quote_prefix = sub.prefix
  from (
    select distinct on (client_id) client_id, substring(quote_number from 4 for 3) as prefix
      from public.quotes
     where quote_number ~ '^QU-[A-Z]{3}-[0-9]{3}$'
     order by client_id, created_at
  ) sub
 where c.id = sub.client_id
   and c.quote_prefix is null;
