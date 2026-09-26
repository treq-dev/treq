-- Remote SSH control-plane schema (Phase 1: contracts and idempotency only).
--
-- No Edge Function reads or writes these tables yet; this migration only
-- fixes the shape of control-plane state per prds/remote-development.md so later
-- phases (Sprites provisioning, certificate issuance) build on stable
-- storage. Every table is scoped to auth.uid() ownership and RLS is enabled
-- on all of them, matching the "Apply RLS to all instance, key, endpoint,
-- repository, and audit tables" security requirement.

-- One managed VM per user (Goal 1). provider_kind and size_preset/region are
-- constrained to the closed sets defined in core::remote_provider so a stray
-- value can never reach an Edge Function.
create table public.remote_instances (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  provider_kind text not null check (provider_kind in ('fly_sprites')),
  provider_resource_id text,
  region text not null check (region in ('us_east', 'us_west', 'eu_west', 'ap_southeast')),
  size_preset text not null check (size_preset in ('small', 'medium', 'large')),
  status text not null default 'unprovisioned' check (status in (
    'unprovisioned', 'provisioning', 'bootstrapping', 'installing_access',
    'verifying', 'ready', 'suspended', 'waking', 'reprovisioning',
    'degraded', 'failed', 'deleting', 'deleted'
  )),
  generation bigint not null default 0,
  endpoint_id uuid,
  image_manifest_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ready_at timestamptz,
  unique (owner_user_id)
);

alter table public.remote_instances enable row level security;

create policy "Users can view own managed instance"
  on public.remote_instances for select
  using (owner_user_id = auth.uid());

-- Mutations to this table happen only through Edge Functions running with
-- the service role (Phase 2+); no client-side insert/update/delete policy is
-- granted here.

-- Idempotent, auditable operation log for every mutating lifecycle call
-- (provision, wake, reprovision, delete, key registration, certificate
-- issuance). The unique constraint on (owner_user_id, idempotency_key) is
-- what makes a repeated request return the existing operation instead of
-- creating a second one.
create table public.remote_instance_operations (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  instance_id uuid references public.remote_instances(id) on delete set null,
  operation_type text not null check (operation_type in (
    'provision', 'wake', 'reprovision', 'delete',
    'register_client_key', 'revoke_client_key', 'issue_certificate',
    'register_endpoint', 'register_repository'
  )),
  status text not null default 'pending' check (status in (
    'pending', 'in_progress', 'succeeded', 'failed'
  )),
  idempotency_key text not null,
  provider_request_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (owner_user_id, idempotency_key)
);

alter table public.remote_instance_operations enable row level security;

create policy "Users can view own instance operations"
  on public.remote_instance_operations for select
  using (owner_user_id = auth.uid());

create index remote_instance_operations_instance_id_idx
  on public.remote_instance_operations (instance_id);

-- Trusted endpoint metadata for both managed and user-managed VMs. A managed
-- endpoint is populated by the control plane once host-key verification
-- succeeds; a user-managed endpoint is populated directly from explicit
-- registration (see core::remote_control_plane::RegisterEndpointRequest).
-- `alias` may only be set when the user explicitly chose alias mode -
-- discovering an alias from ~/.ssh/config never populates this table.
create table public.remote_endpoints (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  instance_id uuid references public.remote_instances(id) on delete cascade,
  source text not null check (source in ('managed', 'user_managed', 'explicit_alias')),
  display_name text not null,
  hostname text not null,
  port int not null default 22 check (port between 1 and 65535),
  username text not null,
  alias text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source <> 'explicit_alias' or alias is not null)
);

alter table public.remote_endpoints enable row level security;

create policy "Users can manage own endpoints"
  on public.remote_endpoints for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

alter table public.remote_instances
  add constraint remote_instances_endpoint_id_fkey
  foreign key (endpoint_id) references public.remote_endpoints(id) on delete set null;

-- Pinned host public keys per endpoint. Kept separate from remote_endpoints
-- so a reprovision-driven host-key rotation can record old and new
-- fingerprints without losing history (see PRD "Host-key verification").
create table public.remote_endpoint_host_keys (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  endpoint_id uuid not null references public.remote_endpoints(id) on delete cascade,
  algorithm text not null,
  fingerprint_sha256 text not null,
  comment text,
  generation bigint not null default 0,
  trusted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (endpoint_id, fingerprint_sha256)
);

alter table public.remote_endpoint_host_keys enable row level security;

create policy "Users can manage own endpoint host keys"
  on public.remote_endpoint_host_keys for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Client SSH public keys a user has registered. Only public material and
-- metadata are stored; Treq never generates or stores a private key
-- (Goal 8). Each key is independently revocable (Goal 6/7).
create table public.remote_client_keys (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  public_key text not null,
  fingerprint_sha256 text not null,
  comment text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (owner_user_id, fingerprint_sha256)
);

alter table public.remote_client_keys enable row level security;

create policy "Users can manage own client keys"
  on public.remote_client_keys for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Repository registrations against an endpoint, keyed by endpoint identity
-- and canonical remote path rather than only a host string (see PRD
-- "Expanded SSH connection model").
create table public.remote_repositories (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  endpoint_id uuid not null references public.remote_endpoints(id) on delete cascade,
  remote_path text not null,
  display_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (endpoint_id, remote_path)
);

alter table public.remote_repositories enable row level security;

create policy "Users can manage own remote repositories"
  on public.remote_repositories for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

-- Append-only audit trail for lifecycle, certificate, host-key, and
-- readiness events (see PRD "Observability and audit"). Writes happen only
-- through the service role; users may read their own events.
create table public.remote_audit_events (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  instance_id uuid references public.remote_instances(id) on delete set null,
  endpoint_id uuid references public.remote_endpoints(id) on delete set null,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.remote_audit_events enable row level security;

create policy "Users can view own audit events"
  on public.remote_audit_events for select
  using (owner_user_id = auth.uid());

create index remote_audit_events_owner_created_idx
  on public.remote_audit_events (owner_user_id, created_at desc);
