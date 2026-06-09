-- Enums ---------------------------------------------------------------------
create type public.user_role as enum ('rocking_staff', 'client_manager', 'client_member');
create type public.profile_status as enum ('pending', 'active');
create type public.client_status as enum ('active', 'inactive');

-- Clients (tenants) ---------------------------------------------------------
create table public.clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  status     public.client_status not null default 'active',
  created_at timestamptz not null default now()
);

-- Email domain -> client mapping (for self-registration) --------------------
create table public.client_domains (
  id         uuid primary key default gen_random_uuid(),
  domain     text not null unique,
  client_id  uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now()
);
-- Domains are always stored lowercased; enforce it.
create unique index client_domains_domain_lower_idx on public.client_domains (lower(domain));

-- Profiles (extends auth.users) --------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  client_id  uuid references public.clients(id) on delete set null,
  role       public.user_role not null default 'client_member',
  status     public.profile_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_client_id_idx on public.profiles (client_id);
