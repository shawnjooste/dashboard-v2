begin;
select plan(4);

insert into public.clients (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Client A'),
  ('22222222-2222-2222-2222-222222222222', 'Client B');
insert into public.client_domains (domain, client_id) values
  ('client-a.com', '11111111-1111-1111-1111-111111111111');

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@client-a.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'shawn@rocking.one'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'stranger@unknown.com');

select is(
  (select role::text from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'client_member', 'matched-domain user becomes client_member');
select is(
  (select status::text from public.profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'pending', 'unknown-domain user becomes pending');
select is(
  (select role::text from public.profiles where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'rocking_staff', 'rocking.one user becomes rocking_staff');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select is(
  (select count(*)::int from public.clients),
  1, 'client_member sees only their own client row');

select * from finish();
rollback;
