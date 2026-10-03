-- Google Workspace OAuth for Pro users. Mirrors 019_linear_oauth.sql: the
-- grant never leaves the server; google-proxy forwards requests with it.

create table public.google_oauth_intents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

alter table public.google_oauth_intents enable row level security;
-- No policies: only service-role Edge Functions touch intents.

create index idx_google_intents_user on public.google_oauth_intents (user_id, created_at);

create table public.google_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  google_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_oauth_tokens enable row level security;
-- No public access to tokens. Service-role Edge Functions use service role key.
