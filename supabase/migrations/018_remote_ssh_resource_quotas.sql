-- Resource quota columns for the Remote SSH control plane
-- (prds/remote-development.md, "Instance lifecycle" > "Resource quotas").
--
-- Every user's managed instance starts at (and, in this delivery, is capped
-- at) a fixed base allocation included in the plan: 5 GB disk, 1 vCPU, 2 GB
-- RAM. Purchasing additional disk or compute as a plan add-on is explicitly
-- deferred (see prds/remote-development.md Non-goals); these columns record the
-- enforced allocation for observability, not a purchasable quantity.

alter table public.remote_instances
  add column disk_quota_gb int not null default 5 check (disk_quota_gb = 5),
  add column vcpu_quota int not null default 1 check (vcpu_quota = 1),
  add column ram_quota_gb int not null default 2 check (ram_quota_gb = 2);

comment on column public.remote_instances.disk_quota_gb is
  'Enforced base disk allocation in GB. Fixed at 5 in this delivery - add-on purchase is not yet implemented (prds/remote-development.md Non-goals).';
comment on column public.remote_instances.vcpu_quota is
  'Enforced base vCPU allocation. Fixed at 1 in this delivery.';
comment on column public.remote_instances.ram_quota_gb is
  'Enforced base RAM allocation in GB. Fixed at 2 in this delivery.';
