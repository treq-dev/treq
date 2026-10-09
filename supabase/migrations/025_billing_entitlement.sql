-- Billing records and the Pro entitlement check (prds/billing-and-teams.md,
-- rollout step 1).
--
-- Stripe stays the source of truth for payment state. The stripe-webhook Edge
-- Function copies the fields Treq needs into these tables, so entitlement
-- checks never call the Stripe API and never match on email. Ownership comes
-- from billing_customers, which maps a Stripe customer to a Treq user. An
-- owner_type of 'organization' is reserved for Team (rollout step 4). Nothing
-- writes organization rows yet.
--
-- Clients only read their own customer and subscription rows. Every write
-- goes through a service-role-only security definer function below, so pgTAP
-- can cover the webhook's effect on the database without Stripe.

create table public.billing_customers (
  owner_type text not null check (owner_type in ('user', 'organization')),
  owner_id uuid not null,
  stripe_customer_id text not null unique,
  -- Set when the owner's first Pro trial starts. Checkout offers a trial only
  -- while this is null.
  trial_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_type, owner_id)
);

create table public.billing_subscriptions (
  stripe_subscription_id text primary key,
  stripe_customer_id text not null,
  -- Null until billing_customers maps stripe_customer_id to an owner. Stripe
  -- does not order webhook events, so a subscription can arrive before the
  -- checkout.session.completed event that names its owner.
  owner_type text check (owner_type in ('user', 'organization')),
  owner_id uuid,
  plan text not null check (plan in ('pro', 'team')),
  status text not null check (status in (
    'incomplete', 'incomplete_expired', 'trialing', 'active',
    'past_due', 'canceled', 'unpaid', 'paused'
  )),
  current_period_end timestamptz,
  -- True when the subscription is set to end at a future date (Stripe's
  -- cancel_at_period_end or cancel_at). It stays entitled until then.
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  -- `created` of the Stripe event that last wrote this row. An older event
  -- that arrives late never overwrites a newer one.
  stripe_event_created timestamptz not null,
  updated_at timestamptz not null default now(),
  check ((owner_type is null) = (owner_id is null))
);

create index idx_billing_subscriptions_owner
  on public.billing_subscriptions (owner_type, owner_id);
create index idx_billing_subscriptions_customer
  on public.billing_subscriptions (stripe_customer_id);

create table public.billing_events (
  stripe_event_id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

alter table public.billing_customers enable row level security;
alter table public.billing_subscriptions enable row level security;
alter table public.billing_events enable row level security;

create policy "Users can view own billing customer"
  on public.billing_customers for select
  to authenticated
  using (owner_type = 'user' and owner_id = (select auth.uid()));

create policy "Users can view own billing subscriptions"
  on public.billing_subscriptions for select
  to authenticated
  using (owner_type = 'user' and owner_id = (select auth.uid()));

-- 008_public_grants.sql gives anon and authenticated full DML on every new
-- public table. Billing rows decide entitlement, so clients get read access
-- only, and billing_events is service-role only.
revoke all on table
  public.billing_customers,
  public.billing_subscriptions,
  public.billing_events
from anon, authenticated;

grant select on table public.billing_customers, public.billing_subscriptions
  to authenticated;

grant select, insert, update, delete on table
  public.billing_customers,
  public.billing_subscriptions,
  public.billing_events
to service_role;

-- ── Entitlement ───────────────────────────────────────────────────────────

-- Is this user entitled to Pro? Every server-side check calls this function.
-- A signed-in user may only ask about themselves. Any other id answers false,
-- so the function cannot be used to probe who pays. The service role may ask
-- about anyone. `role` is the database role PostgREST switched to from the
-- verified JWT, and a security definer function does not change it.
create function public.has_pro(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      p_user_id = (select auth.uid())
      or current_setting('role', true) = 'service_role'
    )
    and exists (
      select 1
      from public.billing_subscriptions s
      where s.owner_type = 'user'
        and s.owner_id = p_user_id
        and s.plan = 'pro'
        and s.status in ('trialing', 'active', 'past_due')
    ),
    false
  );
$$;

revoke all on function public.has_pro(uuid) from public, anon;
grant execute on function public.has_pro(uuid) to authenticated, service_role;

-- public.subscriptions keeps its columns (plan, status, current_period_end)
-- and the status contract the desktop app reads: 'canceled' means the
-- subscription is set to cancel at the period end and is still entitled.
-- The source moves from the Stripe foreign data wrapper to
-- billing_subscriptions. A later migration drops the wrapper.
create or replace function public.get_current_user_subscription()
returns table (
  plan text,
  status text,
  current_period_end timestamp
)
language sql
stable
security definer
set search_path = ''
as $$
  with entitled_sub as (
    select s.status, s.current_period_end, s.cancel_at_period_end
    from public.billing_subscriptions s
    where s.owner_type = 'user'
      and s.owner_id = (select auth.uid())
      and s.plan = 'pro'
      and s.status in ('trialing', 'active', 'past_due')
    order by s.current_period_end desc nulls last
    limit 1
  )
  select
    case when public.has_pro((select auth.uid())) then 'pro' else 'free' end as plan,
    case
      when e.status is null then 'inactive'
      when e.cancel_at_period_end then 'canceled'
      else e.status
    end as status,
    (e.current_period_end at time zone 'utc') as current_period_end
  from (select 1) as _
  left join entitled_sub e on true;
$$;

-- ── Webhook writes (service role only) ────────────────────────────────────
--
-- Each function records the Stripe event id first. A replayed event finds
-- its id in billing_events and changes nothing. The id insert and the row
-- writes commit together, so an event that fails part way is retried whole.

-- customer.subscription.created, .updated and .deleted. Returns 'applied',
-- 'duplicate' (event id seen before) or 'stale' (an event created later
-- already wrote this subscription, or the subscription had already ended).
create function public.billing_record_subscription_event(
  p_event_id text,
  p_event_type text,
  p_event_created timestamptz,
  p_subscription_id text,
  p_customer_id text,
  p_plan text,
  p_status text,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_trial_end timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_type text;
  v_owner_id uuid;
  v_written int;
begin
  if p_event_type not in (
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted'
  ) then
    raise exception 'unsupported subscription event type %', p_event_type
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.billing_events (stripe_event_id, type)
  values (p_event_id, p_event_type)
  on conflict (stripe_event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  select c.owner_type, c.owner_id
    into v_owner_type, v_owner_id
  from public.billing_customers c
  where c.stripe_customer_id = p_customer_id;

  insert into public.billing_subscriptions as s (
    stripe_subscription_id, stripe_customer_id, owner_type, owner_id, plan,
    status, current_period_end, cancel_at_period_end, trial_end,
    stripe_event_created
  )
  values (
    p_subscription_id, p_customer_id, v_owner_type, v_owner_id, p_plan,
    p_status, p_current_period_end, coalesce(p_cancel_at_period_end, false),
    p_trial_end, p_event_created
  )
  on conflict (stripe_subscription_id) do update set
    owner_type = coalesce(excluded.owner_type, s.owner_type),
    owner_id = coalesce(excluded.owner_id, s.owner_id),
    plan = excluded.plan,
    status = excluded.status,
    current_period_end = excluded.current_period_end,
    cancel_at_period_end = excluded.cancel_at_period_end,
    trial_end = excluded.trial_end,
    stripe_event_created = excluded.stripe_event_created,
    updated_at = now()
  -- Stripe never reactivates an ended subscription, so a late event cannot
  -- bring one back.
  where s.stripe_event_created <= excluded.stripe_event_created
    and s.status not in ('canceled', 'incomplete_expired');
  get diagnostics v_written = row_count;

  -- Any event that shows a Pro trial proves the trial was used, even a stale
  -- one.
  if p_plan = 'pro' and p_trial_end is not null then
    update public.billing_customers
    set trial_used_at = now(), updated_at = now()
    where stripe_customer_id = p_customer_id
      and trial_used_at is null;
  end if;

  return case when v_written = 0 then 'stale' else 'applied' end;
end;
$$;

-- checkout.session.completed. Maps the session's customer to the owner that
-- billing-checkout wrote into the session metadata, attaches subscriptions
-- that arrived before the mapping, and records a used trial. A customer keeps
-- its first owner and an owner keeps its first customer, so a session can
-- never move a paid subscription to someone else. Returns 'applied',
-- 'duplicate', 'unknown_owner' or 'owner_conflict'.
create function public.billing_record_checkout_completed(
  p_event_id text,
  p_customer_id text,
  p_owner_type text,
  p_owner_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_type text;
  v_owner_id uuid;
begin
  -- Organizations arrive with Team in rollout step 4.
  if p_owner_type is distinct from 'user' then
    raise exception 'unsupported billing owner type %', p_owner_type
      using errcode = 'invalid_parameter_value';
  end if;

  insert into public.billing_events (stripe_event_id, type)
  values (p_event_id, 'checkout.session.completed')
  on conflict (stripe_event_id) do nothing;
  if not found then
    return 'duplicate';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_owner_id) then
    return 'unknown_owner';
  end if;

  insert into public.billing_customers (owner_type, owner_id, stripe_customer_id)
  values (p_owner_type, p_owner_id, p_customer_id)
  on conflict do nothing;

  select c.owner_type, c.owner_id
    into v_owner_type, v_owner_id
  from public.billing_customers c
  where c.stripe_customer_id = p_customer_id;

  if v_owner_type is distinct from p_owner_type
    or v_owner_id is distinct from p_owner_id then
    return 'owner_conflict';
  end if;

  update public.billing_subscriptions
  set owner_type = p_owner_type, owner_id = p_owner_id, updated_at = now()
  where stripe_customer_id = p_customer_id
    and owner_id is null;

  update public.billing_customers c
  set trial_used_at = now(), updated_at = now()
  where c.stripe_customer_id = p_customer_id
    and c.trial_used_at is null
    and exists (
      select 1
      from public.billing_subscriptions s
      where s.stripe_customer_id = p_customer_id
        and s.plan = 'pro'
        and s.trial_end is not null
    );

  return 'applied';
end;
$$;

-- 008_public_grants.sql's default privileges open every new function to anon
-- and authenticated (see 012_reclose_service_only_function_grants.sql).
revoke all on function public.billing_record_subscription_event(
  text, text, timestamptz, text, text, text, text, timestamptz, boolean, timestamptz
) from public, anon, authenticated;
revoke all on function public.billing_record_checkout_completed(
  text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.billing_record_subscription_event(
  text, text, timestamptz, text, text, text, text, timestamptz, boolean, timestamptz
) to service_role;
grant execute on function public.billing_record_checkout_completed(
  text, text, text, uuid
) to service_role;
