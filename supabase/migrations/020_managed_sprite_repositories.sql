-- Managed Sprite repositories belong directly to the persistent instance.
-- SSH-backed registrations retain endpoint ownership; exactly one transport
-- owner is required for every row.
alter table public.remote_repositories
  add column instance_id uuid references public.remote_instances(id) on delete cascade;

alter table public.remote_repositories
  alter column endpoint_id drop not null;

alter table public.remote_repositories
  add constraint remote_repositories_transport_owner_check
  check (num_nonnulls(endpoint_id, instance_id) = 1);

alter table public.remote_repositories
  drop constraint remote_repositories_endpoint_id_remote_path_key;

create unique index remote_repositories_endpoint_path_key
  on public.remote_repositories (endpoint_id, remote_path)
  where endpoint_id is not null;

create unique index remote_repositories_instance_path_key
  on public.remote_repositories (instance_id, remote_path)
  where instance_id is not null;
