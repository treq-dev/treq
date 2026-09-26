-- Remote SSH trust and authentication (Phase 3: prds/remote-development.md
-- "SSH trust and authentication"). Adds the columns and tables needed for
-- client key algorithm tracking, direct authorized_keys installs, and the
-- wider set of operation types this phase introduces. The SSH CA private key
-- itself is never stored here - only server-side Edge Function secrets ever
-- hold it (see supabase/functions/_shared/remote/ssh-cert.ts).

-- remote_client_keys previously stored only the raw public key text and its
-- fingerprint; certificate signing needs to know the algorithm up front
-- (only ssh-ed25519 is certifiable today) without re-parsing the key on
-- every read.
alter table public.remote_client_keys
  add column algorithm text not null default 'ssh-ed25519';

alter table public.remote_client_keys
  alter column algorithm drop default;

-- Direct-key authentication alternative (PRD "Existing keys without
-- certificates"): tracks which of a user's registered client keys have been
-- installed into which endpoint's authorized_keys, so install/remove is
-- idempotent and auditable rather than a fire-and-forget shell append.
create table public.remote_endpoint_authorized_keys (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  endpoint_id uuid not null references public.remote_endpoints(id) on delete cascade,
  client_key_id uuid not null references public.remote_client_keys(id) on delete cascade,
  installed_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (endpoint_id, client_key_id)
);

alter table public.remote_endpoint_authorized_keys enable row level security;

create policy "Users can manage own authorized key installs"
  on public.remote_endpoint_authorized_keys for all
  using (owner_user_id = auth.uid())
  with check (owner_user_id = auth.uid());

create index remote_endpoint_authorized_keys_endpoint_idx
  on public.remote_endpoint_authorized_keys (endpoint_id);

-- Phase 3 adds authorized-key install/remove and an explicit host-keyscan
-- operation type alongside the Phase 1 set.
alter table public.remote_instance_operations
  drop constraint remote_instance_operations_operation_type_check;

alter table public.remote_instance_operations
  add constraint remote_instance_operations_operation_type_check
  check (operation_type in (
    'provision', 'wake', 'reprovision', 'delete',
    'register_client_key', 'revoke_client_key', 'issue_certificate',
    'register_endpoint', 'register_repository',
    'install_authorized_key', 'remove_authorized_key', 'keyscan_host_key'
  ));
