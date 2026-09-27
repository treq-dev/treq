-- Least-privilege access to the remote control-plane tables (PRD "Security
-- requirements": "Apply RLS to all instance, key, endpoint, repository, and
-- audit tables").
--
-- 015 and 016 gave signed-in users `for all` policies on endpoints, host
-- keys, client keys, repositories, and authorized-key installs, checking
-- only `owner_user_id = auth.uid()`. Because 008_public_grants.sql grants
-- select/insert/update/delete on every public table to anon and
-- authenticated, those policies were the only barrier, and they allowed:
--
--   * a host-key row owned by user B on user A's endpoint_id. The
--     remote-ssh-trust function then returned it as a trusted host key for
--     user A's endpoint, which lets user B intercept A's SSH sessions.
--   * clearing `revoked_at` on your own client key, which undoes a
--     revocation made by an admin or by the control plane.
--   * editing trust state directly (trusted_at, generation, installed_at,
--     removed_at, hostname) without going through an Edge Function.
--   * pointing a repository or endpoint at another user's instance or
--     endpoint through instance_id / endpoint_id.
--
-- No client code writes these tables. Every write goes through an Edge
-- Function that runs as the service role after it has checked ownership
-- (see supabase/functions/_shared/remote/*-store.ts). So users keep read
-- access to their own rows and lose all direct write access. A trigger
-- also checks that every referenced endpoint, instance, and client key
-- belongs to the same owner as the row that references it. The trigger
-- applies to the service role too, so a bug in an Edge Function cannot
-- link one user's trust state to another user's resources.

-- 1. Read-only policies for users.

drop policy "Users can manage own endpoints" on public.remote_endpoints;
create policy "Users can view own endpoints"
  on public.remote_endpoints for select
  using (owner_user_id = auth.uid());

drop policy "Users can manage own endpoint host keys" on public.remote_endpoint_host_keys;
create policy "Users can view own endpoint host keys"
  on public.remote_endpoint_host_keys for select
  using (owner_user_id = auth.uid());

drop policy "Users can manage own client keys" on public.remote_client_keys;
create policy "Users can view own client keys"
  on public.remote_client_keys for select
  using (owner_user_id = auth.uid());

drop policy "Users can manage own remote repositories" on public.remote_repositories;
create policy "Users can view own remote repositories"
  on public.remote_repositories for select
  using (owner_user_id = auth.uid());

drop policy "Users can manage own authorized key installs" on public.remote_endpoint_authorized_keys;
create policy "Users can view own authorized key installs"
  on public.remote_endpoint_authorized_keys for select
  using (owner_user_id = auth.uid());

-- 2. Table privileges. RLS alone is one mistake away from reopening a
-- write path (a new permissive policy, a `for all` copy-paste), so the
-- write privileges from 008_public_grants.sql are removed as well. anon
-- has no reason to touch these tables at all. The service role keeps its
-- privileges and bypasses RLS, which the Edge Functions rely on.
-- remote_audit_retention_config is an operator setting with no user
-- policy, so users get no privileges on it at all.

revoke all on table
  public.remote_instances,
  public.remote_instance_operations,
  public.remote_endpoints,
  public.remote_endpoint_host_keys,
  public.remote_client_keys,
  public.remote_repositories,
  public.remote_audit_events,
  public.remote_endpoint_authorized_keys,
  public.remote_audit_retention_config
from anon, authenticated;

grant select on table
  public.remote_instances,
  public.remote_instance_operations,
  public.remote_endpoints,
  public.remote_endpoint_host_keys,
  public.remote_client_keys,
  public.remote_repositories,
  public.remote_audit_events,
  public.remote_endpoint_authorized_keys
to authenticated;

-- 3. Same-owner checks on foreign keys.
--
-- A foreign key only proves that the referenced row exists, not who owns
-- it. The trigger arguments are pairs of (column name, referenced table).
-- For each non-null column, the referenced row must have the same
-- owner_user_id as the new row. It runs as security definer so the lookup
-- sees the referenced row whatever the caller's RLS view is.

create function public.remote_enforce_same_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  i int := 0;
  ref_column text;
  ref_table regclass;
  ref_id uuid;
  ref_owner uuid;
begin
  while i < tg_nargs loop
    ref_column := tg_argv[i];
    ref_table := tg_argv[i + 1]::regclass;
    ref_id := (to_jsonb(new) ->> ref_column)::uuid;

    if ref_id is not null then
      ref_owner := null;
      execute format('select owner_user_id from %s where id = $1', ref_table)
        into ref_owner
        using ref_id;

      -- A missing row is left for the foreign key itself to reject. Every
      -- referenced table has a not-null owner_user_id, so a null here means
      -- no row. (EXECUTE does not set FOUND, so FOUND cannot be used.)
      if ref_owner is not null and ref_owner <> new.owner_user_id then
        raise exception '%.% must reference a row owned by the same user',
          tg_table_name, ref_column
          using errcode = '42501';
      end if;
    end if;

    i := i + 2;
  end loop;

  return new;
end;
$$;

-- Only the trigger machinery calls this; nobody needs to call it directly.
revoke all on function public.remote_enforce_same_owner() from public, anon, authenticated;

create trigger remote_instances_same_owner
  before insert or update of owner_user_id, endpoint_id on public.remote_instances
  for each row execute function public.remote_enforce_same_owner(
    'endpoint_id', 'public.remote_endpoints'
  );

create trigger remote_endpoints_same_owner
  before insert or update of owner_user_id, instance_id on public.remote_endpoints
  for each row execute function public.remote_enforce_same_owner(
    'instance_id', 'public.remote_instances'
  );

create trigger remote_endpoint_host_keys_same_owner
  before insert or update of owner_user_id, endpoint_id on public.remote_endpoint_host_keys
  for each row execute function public.remote_enforce_same_owner(
    'endpoint_id', 'public.remote_endpoints'
  );

create trigger remote_repositories_same_owner
  before insert or update of owner_user_id, endpoint_id, instance_id on public.remote_repositories
  for each row execute function public.remote_enforce_same_owner(
    'endpoint_id', 'public.remote_endpoints',
    'instance_id', 'public.remote_instances'
  );

create trigger remote_endpoint_authorized_keys_same_owner
  before insert or update of owner_user_id, endpoint_id, client_key_id on public.remote_endpoint_authorized_keys
  for each row execute function public.remote_enforce_same_owner(
    'endpoint_id', 'public.remote_endpoints',
    'client_key_id', 'public.remote_client_keys'
  );
