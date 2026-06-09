begin;
select plan(4);

insert into public.clients (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Client A'),
  ('22222222-2222-2222-2222-222222222222', 'Client B');
insert into public.client_domains (domain, client_id) values
  ('client-a.com', '11111111-1111-1111-1111-111111111111');

insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'manager@client-a.com'),
  ('a2222222-2222-2222-2222-222222222222', 'member@client-a.com'),
  ('a3333333-3333-3333-3333-333333333333', 'staff@rocking.one');
update public.profiles set role = 'client_manager'
  where id = 'a1111111-1111-1111-1111-111111111111';

insert into public.devices (id, client_id, device_identity, hostname) values
  ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'SN-A1', 'A1'),
  ('d2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'SN-A2', 'A2'),
  ('d3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'SN-B1', 'B1');
insert into public.device_assignments (device_id, profile_id) values
  ('d1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.devices), 2,
  'client_manager sees all of their client''s devices');

set local "request.jwt.claims" = '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.devices), 1,
  'client_member sees only assigned devices');
select is((select hostname from public.devices), 'A1',
  'client_member sees the correct assigned device');

set local "request.jwt.claims" = '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.devices), 3,
  'rocking_staff sees every device');

select * from finish();
rollback;
