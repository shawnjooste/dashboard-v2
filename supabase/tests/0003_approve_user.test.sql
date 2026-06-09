begin;
select plan(6);

insert into public.clients (id, name) values
  ('33333333-3333-3333-3333-333333333333', 'Approve Co');
insert into auth.users (id, email) values
  ('f1111111-1111-1111-1111-111111111111', 'staff@rocking.one'),
  ('f2222222-2222-2222-2222-222222222222', 'pending@unknown-x.com'),
  ('f3333333-3333-3333-3333-333333333333', 'other@unknown-y.com');

-- Non-staff caller is rejected.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.approve_pending_user('f2222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', false) $$,
  'only rocking staff may approve users',
  'non-staff caller is rejected');

-- Staff caller with a bad client id is rejected.
set local "request.jwt.claims" = '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.approve_pending_user('f2222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000', false) $$,
  'client does not exist',
  'unknown client is rejected');

-- Staff approves the pending user as a manager.
select lives_ok(
  $$ select public.approve_pending_user('f2222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', true) $$,
  'staff can approve a pending user');

reset role;
select is(
  (select status::text from public.profiles where id = 'f2222222-2222-2222-2222-222222222222'),
  'active', 'approved user is now active');
select is(
  (select client_id::text from public.profiles where id = 'f2222222-2222-2222-2222-222222222222'),
  '33333333-3333-3333-3333-333333333333', 'approved user is linked to the client');
select is(
  (select role::text from public.profiles where id = 'f2222222-2222-2222-2222-222222222222'),
  'client_manager', 'make_manager promoted the user to client_manager');

select * from finish();
rollback;
