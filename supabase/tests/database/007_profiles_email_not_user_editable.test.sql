-- A user must not be able to become Pro by editing profiles.email to a
-- paying customer's address (024_subscriptions_trusted_email.sql).
begin;
select plan(5);

insert into auth.users (id, email, aud, role)
values ('00000000-0000-0000-0000-0000000000e1', 'victim-check@example.com', 'authenticated', 'authenticated');

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE'),
  'authenticated cannot update profiles.email'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE'),
  'authenticated can still update profiles.full_name'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

select throws_ok(
  $$update public.profiles set email = 'paying@example.com' where id = auth.uid()$$,
  '42501',
  null,
  'a user editing their own profiles.email is refused'
);

reset role;

update auth.users set email = 'renamed-check@example.com'
where id = '00000000-0000-0000-0000-0000000000e1';
select is(
  (select email from public.profiles where id = '00000000-0000-0000-0000-0000000000e1'),
  'renamed-check@example.com',
  'profiles.email follows auth.users.email'
);

select ok(
  position('auth.users' in pg_get_functiondef('public.get_current_user_subscription()'::regprocedure)) > 0,
  'get_current_user_subscription() matches on auth.users.email'
);

select * from finish();
rollback;
