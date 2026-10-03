-- 013 matched the Stripe customer to the caller through public.profiles.email,
-- which the "Users can update own profile" policy lets a user change. Setting
-- it to a paying customer's address made the caller Pro. Match on
-- auth.users.email instead, which only Supabase Auth writes, and stop users
-- editing profiles.email at all (a trigger keeps it in sync from auth.users).
create or replace function public.get_current_user_subscription()
returns table (
  plan text,
  status text,
  current_period_end timestamp
)
language sql
security definer
set search_path = ''
as $$
  with customer as (
    select c.id
    from treq_internal.stripe_customers c
    join auth.users u on c.email = u.email
    where u.id = auth.uid()
    limit 1
  ),
  active_sub as (
    select
      s.attrs->>'status' as raw_status,
      s.current_period_end,
      coalesce((s.attrs->>'cancel_at_period_end')::boolean, false) as cancel_at_period_end
    from treq_internal.stripe_subscriptions s
    join customer c on s.customer = c.id
    where s.attrs->>'status' in ('active', 'trialing', 'past_due')
    order by s.current_period_end desc
    limit 1
  )
  select
    case when a.raw_status is not null then 'pro' else 'free' end as plan,
    case
      when a.raw_status is null then 'inactive'
      when a.cancel_at_period_end then 'canceled'
      else a.raw_status
    end as status,
    a.current_period_end
  from (select 1) as _
  left join active_sub a on true;
$$;

revoke all on function public.get_current_user_subscription() from public, anon;
grant execute on function public.get_current_user_subscription() to authenticated, service_role;

-- Column privileges cannot narrow a table-level UPDATE grant, so revoke the
-- table grant and re-grant UPDATE on every column except id and email.
revoke update on public.profiles from authenticated, anon;
do $$
declare
  cols text;
begin
  select string_agg(quote_ident(column_name), ', ')
    into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name not in ('id', 'email');
  if cols is not null then
    execute format('grant update (%s) on public.profiles to authenticated', cols);
  end if;
end;
$$;

create or replace function treq_internal.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

revoke all on function treq_internal.sync_profile_email() from public, anon, authenticated;

drop trigger if exists sync_profile_email on auth.users;
create trigger sync_profile_email
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function treq_internal.sync_profile_email();

-- PKCE for the Pro Google OAuth flow. Only service-role Edge Functions read
-- intents (RLS on, no policies), so the verifier never reaches the browser.
alter table public.google_oauth_intents add column code_verifier text;
