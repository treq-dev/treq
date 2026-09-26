-- Remote SSH observability and operations (Phase 7:
-- prds/remote-development.md "Observability and operations"). Adds the columns the
-- audit trail was missing to satisfy "Control-plane events" in full
-- (correlation id, provider request id, operation duration), a named
-- retention window plus a pruning function, failure-inspection views, and
-- the storage an admin Edge Function needs to revoke a client key or force
-- an instance recovery with its own audit trail.

-- ── Correlation, provider request id, and duration on every audit row ──────
--
-- The PRD requires "correlation IDs spanning the desktop request, Edge
-- Function operation, provider request, and SSH command" plus "idempotency
-- key and operation duration" as first-class recorded fields, not buried
-- inside the free-form `detail` jsonb where a query for "was this a partial
-- provider failure" would need to unpack it row by row.
alter table public.remote_audit_events
  add column correlation_id text,
  add column provider_request_id text,
  add column idempotency_key text,
  add column duration_ms integer,
  add column severity text not null default 'info'
    check (severity in ('info', 'warning', 'error'));

create index remote_audit_events_correlation_id_idx
  on public.remote_audit_events (correlation_id)
  where correlation_id is not null;

comment on column public.remote_audit_events.correlation_id is
  'Request-scoped id threaded through the desktop request, this Edge Function operation, the provider call, and (when echoed back) the SSH command that triggered it. See supabase/functions/_shared/remote/correlation.ts.';
comment on column public.remote_audit_events.severity is
  'Coarse severity so failure-inspection views can filter without pattern-matching event_type suffixes.';

-- ── Retention policy ────────────────────────────────────────────────────────
--
-- Named retention window (PRD open question: "What retention period applies
-- to audit records and provider operation metadata?" — answered here as a
-- named, changeable constant rather than a magic number scattered across
-- call sites). 90 days covers a quarter of lifecycle/certificate history for
-- support and security review while keeping the append-only table bounded.
create table public.remote_audit_retention_config (
  id boolean primary key default true check (id),
  retention_days integer not null default 90 check (retention_days > 0)
);

insert into public.remote_audit_retention_config (id, retention_days) values (true, 90);

alter table public.remote_audit_retention_config enable row level security;
-- No select/insert/update/delete policy for normal users: retention config
-- is an operational knob, readable/writable only by the service role (used
-- by the cleanup function below and the admin Edge Function).

-- Prunes remote_audit_events older than the configured retention window.
-- Runs as the function owner (postgres) via `security definer` so the
-- service role can invoke it without needing direct delete rights on the
-- table, matching this repo's existing service-role-only wrapper pattern
-- (see 005_merge_queue_pgmq.sql). No pg_cron extension is enabled anywhere
-- in this project's migrations, so this is exposed as a callable function
-- rather than a scheduled job; the `remote-admin` Edge Function's
-- `prune_audit_events` action is the documented way to run it (manually, or
-- from an external scheduler such as a Supabase cron-enabled project or a
-- CI/ops cron hitting that endpoint).
create or replace function public.prune_remote_audit_events()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count bigint;
  window_days integer;
begin
  select retention_days into window_days from public.remote_audit_retention_config where id = true;
  window_days := coalesce(window_days, 90);

  delete from public.remote_audit_events
  where created_at < now() - make_interval(days => window_days);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.prune_remote_audit_events() from public;
grant execute on function public.prune_remote_audit_events() to service_role;

-- ── Failure inspection views ─────────────────────────────────────────────
--
-- Queryable, non-raw surfaces over the audit trail for "operational
-- dashboards and failure inspection tooling". Each view already excludes
-- `detail` keys that could carry secrets at the call site (recordAuditEvent
-- callers never put secrets in `detail` - see audit.ts - but the views are
-- scoped to specific, reviewed columns/keys regardless, rather than
-- `select *`, so a future careless caller can't leak through here).
create view public.remote_recent_failures as
select
  id,
  owner_user_id,
  instance_id,
  endpoint_id,
  event_type,
  correlation_id,
  provider_request_id,
  idempotency_key,
  duration_ms,
  detail ->> 'stage' as readiness_stage,
  detail ->> 'reason' as reason,
  detail ->> 'error' as error_message,
  detail ->> 'kind' as failure_kind,
  created_at
from public.remote_audit_events
where severity = 'error'
   or event_type like '%_failed'
order by created_at desc;

comment on view public.remote_recent_failures is
  'Non-raw, queryable view of readiness-stage, provider, certificate, and host-key failures for operator inspection. See prds/remote-development.md "operational dashboards and failure inspection tooling".';

create view public.remote_instance_health as
select
  i.id as instance_id,
  i.owner_user_id,
  i.status,
  i.generation,
  i.region,
  i.size_preset,
  i.ready_at,
  i.updated_at,
  (
    select count(*) from public.remote_audit_events e
    where e.instance_id = i.id and e.severity = 'error' and e.created_at > now() - interval '24 hours'
  ) as failures_last_24h,
  (
    select max(e.created_at) from public.remote_audit_events e
    where e.instance_id = i.id and e.severity = 'error'
  ) as last_failure_at
from public.remote_instances i;

comment on view public.remote_instance_health is
  'One row per managed instance with a rolling failure count, for an at-a-glance operational dashboard without hand-rolling the join every time.';

-- Views inherit RLS from their underlying tables' policies only when queried
-- as the invoking user; both are intended for service-role/admin use (the
-- remote-admin Edge Function), so no additional grant to `authenticated` is
-- added here. A user who wants their own audit history already has direct
-- select access to remote_audit_events.
revoke all on public.remote_recent_failures from public, anon, authenticated;
revoke all on public.remote_instance_health from public, anon, authenticated;
grant select on public.remote_recent_failures to service_role;
grant select on public.remote_instance_health to service_role;

-- ── Administrative key revocation and instance recovery ─────────────────
--
-- The 'admin_revoke_client_key' and 'admin_force_recover_instance'
-- operation types record the admin action distinctly from a user's own
-- self-service revoke/reprovision, and the audit event types below record
-- who (the operator, by admin-key identity, not a Supabase user id) took the
-- action.
alter table public.remote_instance_operations
  drop constraint remote_instance_operations_operation_type_check;

alter table public.remote_instance_operations
  add constraint remote_instance_operations_operation_type_check
  check (operation_type in (
    'provision', 'wake', 'reprovision', 'delete',
    'register_client_key', 'revoke_client_key', 'issue_certificate',
    'register_endpoint', 'register_repository',
    'install_authorized_key', 'remove_authorized_key', 'keyscan_host_key',
    'admin_revoke_client_key', 'admin_force_recover_instance'
  ));
