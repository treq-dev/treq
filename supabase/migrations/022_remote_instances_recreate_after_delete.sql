-- One managed VM per user counts only instances that still exist. Deleting
-- the cloud workspace keeps its row (status 'deleted') for audit history,
-- so the original `unique (owner_user_id)` made every later `ensure` fail
-- with a unique violation and the user could never create one again. A
-- recreated VM gets a new row, so its instance id and endpoint id are new
-- and saved repository descriptors for the deleted VM cannot match it.
alter table public.remote_instances
  drop constraint remote_instances_owner_user_id_key;

create unique index remote_instances_one_live_per_owner
  on public.remote_instances (owner_user_id)
  where status <> 'deleted';
