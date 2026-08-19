-- API keys for the scoped quote API. Service-role only (RLS on, no policies,
-- matching quote_prefix_counters). Only the sha256 of a key is stored; the
-- key itself is shown once by scripts/api-key.mjs and never again.
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  key_hash     text not null unique,
  key_prefix   text not null,
  profile_id   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
alter table public.api_keys enable row level security;
