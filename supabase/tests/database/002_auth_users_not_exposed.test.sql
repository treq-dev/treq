-- Regression test for the Supabase `auth_users_exposed` lint finding:
-- public.subscriptions used to join auth.users directly. It now sources
-- from a security definer function instead. The function itself reads
-- auth.users.email (024): profiles.email was user-editable, so matching on it
-- let anyone claim a paying customer's subscription. A SQL function body
-- creates no pg_depend edge, so the view stays clear of the lint.
-- The pg_depend check below mirrors how the linter itself detects exposure
-- (a public-schema view with a dependency edge to auth.users), so this
-- fails the same way the lint would if the join ever comes back.
begin;
select plan(4);

select has_view('public', 'subscriptions', 'public.subscriptions view exists');

select ok(
  not exists (
    select 1
    from pg_rewrite rw
    join pg_depend d on d.objid = rw.oid and d.refobjid = 'auth.users'::regclass
    where rw.ev_class = 'public.subscriptions'::regclass
  ),
  'public.subscriptions has no pg_depend edge to auth.users (auth_users_exposed check)'
);

select ok(
  position('auth.users' in pg_get_viewdef('public.subscriptions'::regclass)) = 0,
  'public.subscriptions view definition does not mention auth.users'
);

select ok(
  position('public.profiles' in pg_get_functiondef('public.get_current_user_subscription()'::regprocedure)) = 0,
  'get_current_user_subscription() does not trust user-editable profiles.email'
);

select * from finish();
rollback;
