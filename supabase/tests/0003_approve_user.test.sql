begin;
select plan(3);

insert into public.clients (id, name) values
  ('33333333-3333-3333-3333-333333333333', 'Approve Co');
insert into auth.users (id, email) values
  ('f1111111-1111-1111-1111-111111111111', 'staff@rocking.one'),
  ('f2222222-2222-2222-2222-222222222222', 'pending@unknown-x.com');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.approve_pending_user('f2222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', false) $$,
  'staff can approve a pending user');

reset role;
select is(
  (select status::text from public.profiles where id = 'f2222222-2222-2222-2222-222222222222'),
  'active', 'approved user is now active');
select is(
  (select client_id::text from public.profiles where id = 'f2222222-2222-2222-2222-222222222222'),
  '33333333-3333-3333-3333-333333333333', 'approved user is linked to the client');

select * from finish();
rollback;
