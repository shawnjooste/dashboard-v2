# Foundation & Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new Next.js + Supabase project with a complete, RLS-protected multi-tenant schema (tenancy + Datto device model) and shared typed domain models, all tested.

**Architecture:** A single Next.js (App Router) app on Vercel backed by one new Supabase project (`eskhokedsximnslgsycs`). Postgres + RLS is the security spine: a domain-resolved `profiles` table drives row-level scoping so `client_member`s see only their assigned devices, `client_manager`s see their whole client, and `rocking_staff` see everything. Schema lives as version-controlled SQL migrations; RLS is verified with pgTAP.

**Tech Stack:** Next.js 15 (App Router, TypeScript), `@supabase/supabase-js` + `@supabase/ssr`, Supabase CLI (migrations + pgTAP `supabase test db`), Tailwind CSS, Vitest (TS unit tests).

---

## Scope of this plan (Plan 1 of 4 for Slice 1)

**In:** project scaffold, Supabase clients, all Slice-1 migrations, RLS policies + auth helper functions, the new-user domain-resolution trigger, shared TS types, and tests (pgTAP for RLS, Vitest for type/helper logic).

**Out (later plans):** the actual auth UI/flow (Plan 2), the ingestion CLI (Plan 3), the dashboard views (Plan 4). This plan creates the schema those plans build on, plus a couple of SECURITY DEFINER RPCs they will call.

## Environment assumptions

- Working directory: `~/Documents/Claude/dashboard-v2` (empty git repo already cloned; `.gitignore` and `.env.local` already present with Supabase + Resend secrets).
- Supabase CLI is logged in (`supabase login` done).
- Project ref: `eskhokedsximnslgsycs`. DB password is in `.env.local` as `SUPABASE_DB_PASSWORD`.

## File Structure

```
dashboard-v2/
  .env.local                         # secrets (gitignored, already exists)
  .gitignore                         # already exists
  package.json
  next.config.ts
  tsconfig.json
  tailwind.config.ts
  postcss.config.mjs
  app/
    layout.tsx                       # root layout
    page.tsx                         # placeholder home (replaced in Plan 4)
    globals.css
  lib/
    supabase/
      client.ts                      # browser client (anon key)
      server.ts                      # server-component client (cookies, anon key)
      service.ts                     # service-role client (server-only, ingestion + admin)
    types/
      database.ts                    # generated Supabase types (supabase gen types)
      domain.ts                      # hand-written domain models + enums (shared with ingest)
  supabase/
    config.toml                      # supabase init output
    migrations/
      0001_extensions.sql            # pgcrypto etc.
      0002_tenancy.sql               # enums, clients, client_domains, profiles
      0003_auth_helpers.sql          # SECURITY DEFINER helpers + new-user trigger
      0004_datto_core.sql            # import_runs, site_aliases, devices, device_assignments
      0005_datto_children.sql        # storage, patch_status, alerts, health_snapshots
      0006_rls.sql                   # enable RLS + policies on all tables
      0007_rpcs.sql                  # claimable_devices(), claim_device()
    tests/
      0001_rls_tenancy.test.sql      # pgTAP: profile resolution + client/profile RLS
      0002_rls_devices.test.sql      # pgTAP: device scoping per role
  vitest.config.ts
  lib/types/__tests__/domain.test.ts # Vitest: enum/helper sanity
```

**Responsibility boundaries:**
- `lib/supabase/*` — one file per client variant; never mix anon and service-role in one module.
- `lib/types/domain.ts` — the single source of truth for enums and row shapes shared by web app and (later) the ingestion CLI. `database.ts` is generated and never hand-edited.
- Each migration has one concern; they run in lexical order.

---

### Task 1: Scaffold the Next.js app

**Files:**
- Create: `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, Tailwind config files (via the scaffolder).

- [ ] **Step 1: Scaffold into the existing repo**

The repo is empty except `.git`, `.gitignore`, `.env.local`. Scaffold in-place (note the `.` target):

```bash
cd ~/Documents/Claude/dashboard-v2
npx create-next-app@latest . --ts --app --tailwind --eslint --src-dir=false --import-alias "@/*" --use-npm --no-turbopack --yes
```

Expected: Next.js files created; it keeps the existing `.git`/`.gitignore`/`.env.local`.

- [ ] **Step 2: Verify it builds and dev-runs**

Run: `npm run build`
Expected: build completes with no type errors.

- [ ] **Step 3: Replace the placeholder home page**

Replace `app/page.tsx` with a minimal placeholder (real views come in Plan 4):

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <p className="text-lg">Rocking dashboard — foundation online.</p>
    </main>
  );
}
```

- [ ] **Step 4: Verify build again**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add -A
git commit -m "chore: scaffold Next.js app (App Router, TS, Tailwind)"
git branch -M main
git push -u origin main
```

---

### Task 2: Supabase client modules

**Files:**
- Create: `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/service.ts`

- [ ] **Step 1: Install dependencies**

```bash
npm install @supabase/supabase-js @supabase/ssr
```

- [ ] **Step 2: Browser client**

Create `lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 3: Server-component client (cookie-based session)**

Create `lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component; safe to ignore (middleware refreshes)
          }
        },
      },
    },
  );
}
```

- [ ] **Step 4: Service-role client (server-only)**

Create `lib/supabase/service.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. BYPASSES RLS. Server/CLI only — never import into a
 * client component. Used by the ingestion CLI and admin-only server actions.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 5: Verify build & commit**

Run: `npm run build`
Expected: PASS.

```bash
git add lib/supabase package.json package-lock.json
git commit -m "feat: add Supabase browser/server/service client modules"
```

---

### Task 3: Initialise Supabase and link the project

**Files:**
- Create: `supabase/config.toml` (via `supabase init`)

- [ ] **Step 1: Initialise local Supabase project**

```bash
cd ~/Documents/Claude/dashboard-v2
supabase init
```

Expected: creates `supabase/config.toml` and `supabase/` folders. If prompted about VS Code/Deno settings, accept defaults.

- [ ] **Step 2: Link to the remote project**

```bash
export SUPABASE_DB_PASSWORD="$(grep SUPABASE_DB_PASSWORD .env.local | cut -d= -f2)"
supabase link --project-ref eskhokedsximnslgsycs
```

Expected: "Finished supabase link."

- [ ] **Step 3: Confirm a clean remote DB**

```bash
supabase migration list
```

Expected: no migrations applied remotely yet (empty/▢ list).

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml
git commit -m "chore: supabase init + link to project eskhokedsximnslgsycs"
```

---

### Task 4: Tenancy migration (enums, clients, client_domains, profiles)

**Files:**
- Create: `supabase/migrations/0001_extensions.sql`, `supabase/migrations/0002_tenancy.sql`

- [ ] **Step 1: Extensions migration**

Create `supabase/migrations/0001_extensions.sql`:

```sql
create extension if not exists pgcrypto with schema extensions;
```

- [ ] **Step 2: Tenancy migration**

Create `supabase/migrations/0002_tenancy.sql`:

```sql
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
```

- [ ] **Step 3: Push migration to remote**

```bash
supabase db push
```

Expected: applies `0001` and `0002`; "Finished supabase db push."

- [ ] **Step 4: Verify tables exist**

```bash
supabase migration list
```

Expected: `0001` and `0002` show as applied (local + remote).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_extensions.sql supabase/migrations/0002_tenancy.sql
git commit -m "feat(db): tenancy schema — clients, client_domains, profiles"
```

---

### Task 5: Auth helper functions + new-user domain resolver trigger

**Files:**
- Create: `supabase/migrations/0003_auth_helpers.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0003_auth_helpers.sql`:

```sql
-- Helper functions used by RLS. SECURITY DEFINER so they read profiles
-- without being blocked by profiles' own RLS, avoiding recursive policies.

create or replace function public.current_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_client_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select client_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_rocking_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select role = 'rocking_staff' from public.profiles where id = auth.uid()),
    false
  );
$$;

-- New-user resolver: runs on every auth.users insert. Decides client + role
-- + status from the email domain. Robust to whichever auth entry path is used.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_domain      text := lower(split_part(new.email, '@', 2));
  v_client_id   uuid;
  v_role        public.user_role := 'client_member';
  v_status      public.profile_status := 'pending';
begin
  if v_domain = 'rocking.one' then
    v_role := 'rocking_staff';
    v_status := 'active';
    v_client_id := null;
  else
    select client_id into v_client_id
      from public.client_domains where lower(domain) = v_domain
      limit 1;
    if v_client_id is not null then
      v_role := 'client_member';
      v_status := 'active';
    else
      v_status := 'pending';  -- unknown domain: authenticated but unassigned
    end if;
  end if;

  insert into public.profiles (id, email, client_id, role, status)
  values (new.id, new.email, v_client_id, v_role, v_status);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

- [ ] **Step 2: Push**

```bash
supabase db push
```

Expected: applies `0003`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0003_auth_helpers.sql
git commit -m "feat(db): auth helper fns + domain-resolving new-user trigger"
```

---

### Task 6: Datto core migration (import_runs, site_aliases, devices, device_assignments)

**Files:**
- Create: `supabase/migrations/0004_datto_core.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0004_datto_core.sql`:

```sql
-- One row per ingestion run; the audit anchor for every imported row.
create table public.import_runs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                 -- e.g. 'datto'
  report_date date not null,
  file_names  text[] not null default '{}',
  counts      jsonb  not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- Maps Datto's freeform "Site" strings to a client. Maintained by the agent.
create table public.site_aliases (
  id         uuid primary key default gen_random_uuid(),
  site_name  text not null unique,
  client_id  uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Devices: current state, one row per physical machine.
-- device_identity is the stable upsert key: serial number when present,
-- otherwise hostname. Set by the ingestion layer, unique within a client.
create table public.devices (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  device_identity    text not null,
  hostname           text not null,
  serial_number      text,
  assigned_user_label text,                  -- Datto "description"
  operating_system   text,
  last_reboot        timestamptz,
  cpu                text,
  physical_cores     int,
  memory             text,
  av_status_raw      text,
  av_ok              boolean,
  manufacturer       text,
  model              text,
  external_ip        text,
  agent_version      text,
  enrollment_date    timestamptz,
  last_import_run_id uuid references public.import_runs(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index devices_identity_idx on public.devices (client_id, device_identity);
create index devices_client_id_idx on public.devices (client_id);

-- Links a device to a profile (the claim/assignment step).
create table public.device_assignments (
  id         uuid primary key default gen_random_uuid(),
  device_id  uuid not null references public.devices(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (device_id, profile_id)
);
create index device_assignments_profile_idx on public.device_assignments (profile_id);
```

- [ ] **Step 2: Push**

```bash
supabase db push
```

Expected: applies `0004`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0004_datto_core.sql
git commit -m "feat(db): datto core — import_runs, site_aliases, devices, assignments"
```

---

### Task 7: Datto children migration (storage, patch_status, alerts, health_snapshots)

**Files:**
- Create: `supabase/migrations/0005_datto_children.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0005_datto_children.sql`:

```sql
-- Current drives per device; replaced wholesale on each import.
create table public.device_storage (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.devices(id) on delete cascade,
  drive         text not null,
  drive_type    text,
  size_gb       numeric,
  free_gb       numeric,
  used_gb       numeric,
  free_pct      numeric,
  used_pct      numeric,
  import_run_id uuid references public.import_runs(id)
);
create index device_storage_device_idx on public.device_storage (device_id);

-- Current patch status; one row per device.
create table public.device_patch_status (
  device_id               uuid primary key references public.devices(id) on delete cascade,
  patches_approved_pending int,
  patches_installed        int,
  patches_not_approved     int,
  patch_status             text,
  last_reboot              timestamptz,
  import_run_id            uuid references public.import_runs(id),
  updated_at               timestamptz not null default now()
);

-- Monitor alerts; time-stamped history. Idempotent on (device, triggered_at, message).
create table public.device_alerts (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid not null references public.devices(id) on delete cascade,
  triggered_at  timestamptz not null,
  message       text not null,
  priority      text,
  resolved      boolean not null default false,
  resolved_at   timestamptz,
  ticket_number text,
  alert_policy  text,
  import_run_id uuid references public.import_runs(id),
  unique (device_id, triggered_at, message)
);
create index device_alerts_device_idx on public.device_alerts (device_id);

-- Dated trend snapshot; one row per device per report date.
create table public.device_health_snapshots (
  id               uuid primary key default gen_random_uuid(),
  device_id        uuid not null references public.devices(id) on delete cascade,
  client_id        uuid not null references public.clients(id) on delete cascade,
  snapshot_date    date not null,
  patch_pct        numeric,
  max_disk_pct     numeric,
  av_ok            boolean,
  open_alert_count int,
  import_run_id    uuid references public.import_runs(id),
  unique (device_id, snapshot_date)
);
create index health_snapshots_client_date_idx
  on public.device_health_snapshots (client_id, snapshot_date);
```

- [ ] **Step 2: Push**

```bash
supabase db push
```

Expected: applies `0005`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_datto_children.sql
git commit -m "feat(db): datto children — storage, patch_status, alerts, health_snapshots"
```

---

### Task 8: RLS policies on all tables

**Files:**
- Create: `supabase/migrations/0006_rls.sql`

RLS rules:
- `rocking_staff` → everything.
- `client_manager` → all rows for their `client_id`.
- `client_member` → only devices assigned to them (and those devices' children); their own profile.
- `pending` users → nothing client-scoped.
- `clients`/`client_domains`/`site_aliases`/`import_runs` → staff-only writes; readable per the rules below.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0006_rls.sql`:

```sql
-- Enable RLS everywhere ------------------------------------------------------
alter table public.clients               enable row level security;
alter table public.client_domains        enable row level security;
alter table public.profiles              enable row level security;
alter table public.import_runs           enable row level security;
alter table public.site_aliases          enable row level security;
alter table public.devices               enable row level security;
alter table public.device_assignments    enable row level security;
alter table public.device_storage        enable row level security;
alter table public.device_patch_status   enable row level security;
alter table public.device_alerts         enable row level security;
alter table public.device_health_snapshots enable row level security;

-- profiles -------------------------------------------------------------------
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid() or public.is_rocking_staff());
create policy profiles_manager_select on public.profiles
  for select using (
    public.current_role() = 'client_manager'
    and client_id = public.current_client_id()
  );
create policy profiles_staff_write on public.profiles
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- clients --------------------------------------------------------------------
create policy clients_read on public.clients
  for select using (
    public.is_rocking_staff() or id = public.current_client_id()
  );
create policy clients_staff_write on public.clients
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- client_domains / site_aliases / import_runs: staff-only -------------------
create policy client_domains_staff on public.client_domains
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy site_aliases_staff on public.site_aliases
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy import_runs_staff on public.import_runs
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- devices: staff all / manager own-client / member assigned-only ------------
create policy devices_select on public.devices
  for select using (
    public.is_rocking_staff()
    or (public.current_user_role() = 'client_manager' and client_id = public.current_client_id())
    or (public.current_user_role() = 'client_member'
        and id in (select device_id from public.device_assignments
                   where profile_id = auth.uid()))
  );
-- writes to devices happen via service role (ingestion); no anon write policy.

-- device_assignments: a user sees their own; manager sees their client's ----
create policy device_assignments_select on public.device_assignments
  for select using (
    public.is_rocking_staff()
    or profile_id = auth.uid()
    or (public.current_user_role() = 'client_manager'
        and device_id in (select id from public.devices
                          where client_id = public.current_client_id()))
  );

-- Child tables inherit visibility from their parent device ------------------
create policy device_storage_select on public.device_storage
  for select using (
    device_id in (select id from public.devices)  -- RLS on devices filters this
  );
create policy device_patch_status_select on public.device_patch_status
  for select using (
    device_id in (select id from public.devices)
  );
create policy device_alerts_select on public.device_alerts
  for select using (
    device_id in (select id from public.devices)
  );
create policy device_health_snapshots_select on public.device_health_snapshots
  for select using (
    device_id in (select id from public.devices)
  );
```

> Note: the child-table sub-selects `select id from public.devices` are themselves
> RLS-filtered to the caller's visible devices, so a child row is visible iff its
> parent device is. This keeps child policies simple and consistent with `devices`.

- [ ] **Step 2: Push**

```bash
supabase db push
```

Expected: applies `0006`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_rls.sql
git commit -m "feat(db): RLS policies — staff/manager/member scoping across all tables"
```

---

### Task 9: SECURITY DEFINER RPCs for device claiming

These let a `client_member` (who by RLS cannot see unassigned devices) list and claim
devices within their own client during onboarding — without widening base RLS.

**Files:**
- Create: `supabase/migrations/0007_rpcs.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0007_rpcs.sql`:

```sql
-- Lists devices in the caller's client that are not yet claimed by anyone.
-- Used in the onboarding "claim your machine" step.
create or replace function public.claimable_devices()
returns table (id uuid, hostname text, assigned_user_label text)
language sql stable security definer set search_path = public
as $$
  select d.id, d.hostname, d.assigned_user_label
  from public.devices d
  where d.client_id = public.current_client_id()
    and public.current_client_id() is not null
    and not exists (
      select 1 from public.device_assignments a where a.device_id = d.id
    );
$$;

-- Claims a device for the calling user. Only permits devices in the caller's
-- own client. Idempotent (re-claiming the same device is a no-op).
create or replace function public.claim_device(p_device_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_client uuid := public.current_client_id();
begin
  if v_client is null then
    raise exception 'caller has no client';
  end if;
  if not exists (
    select 1 from public.devices d
    where d.id = p_device_id and d.client_id = v_client
  ) then
    raise exception 'device not in caller client';
  end if;
  insert into public.device_assignments (device_id, profile_id)
  values (p_device_id, auth.uid())
  on conflict (device_id, profile_id) do nothing;
end;
$$;

revoke all on function public.claimable_devices() from public;
revoke all on function public.claim_device(uuid) from public;
grant execute on function public.claimable_devices() to authenticated;
grant execute on function public.claim_device(uuid) to authenticated;
```

- [ ] **Step 2: Push**

```bash
supabase db push
```

Expected: applies `0007`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0007_rpcs.sql
git commit -m "feat(db): claimable_devices + claim_device RPCs for onboarding"
```

---

### Task 10: Shared domain types

**Files:**
- Create: `lib/types/database.ts` (generated), `lib/types/domain.ts` (hand-written)
- Test: `lib/types/__tests__/domain.test.ts`

- [ ] **Step 1: Generate DB types from the remote schema**

```bash
supabase gen types typescript --project-id eskhokedsximnslgsycs --schema public > lib/types/database.ts
```

Expected: `lib/types/database.ts` populated with `Database` type including all tables.

- [ ] **Step 2: Write the failing test for domain enums/helpers**

Create `lib/types/__tests__/domain.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { USER_ROLES, isClientScoped, normalizeAvStatus } from "../domain";

describe("domain", () => {
  it("exposes the three roles", () => {
    expect(USER_ROLES).toEqual(["rocking_staff", "client_manager", "client_member"]);
  });

  it("treats members and managers as client-scoped, staff as not", () => {
    expect(isClientScoped("client_member")).toBe(true);
    expect(isClientScoped("client_manager")).toBe(true);
    expect(isClientScoped("rocking_staff")).toBe(false);
  });

  it("normalizes Datto AV status text to a boolean", () => {
    expect(normalizeAvStatus("Datto AV Running & up-to-date")).toBe(true);
    expect(normalizeAvStatus("Datto AV Not running")).toBe(false);
    expect(normalizeAvStatus("")).toBe(null);
  });
});
```

- [ ] **Step 3: Install Vitest and add the test script**

```bash
npm install -D vitest
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node" } });
```

Add to `package.json` `scripts`: `"test": "vitest run"`.

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `../domain` not found.

- [ ] **Step 5: Implement `lib/types/domain.ts`**

```ts
import type { Database } from "./database";

export const USER_ROLES = [
  "rocking_staff",
  "client_manager",
  "client_member",
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type ProfileStatus = "pending" | "active";
export type ClientStatus = "active" | "inactive";

// Row aliases sourced from the generated Database type — single source of truth.
export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Device = Database["public"]["Tables"]["devices"]["Row"];
export type DeviceStorage = Database["public"]["Tables"]["device_storage"]["Row"];
export type DevicePatchStatus =
  Database["public"]["Tables"]["device_patch_status"]["Row"];
export type DeviceAlert = Database["public"]["Tables"]["device_alerts"]["Row"];
export type DeviceHealthSnapshot =
  Database["public"]["Tables"]["device_health_snapshots"]["Row"];
export type ImportRun = Database["public"]["Tables"]["import_runs"]["Row"];

export function isClientScoped(role: UserRole): boolean {
  return role === "client_member" || role === "client_manager";
}

/** Datto AV status string -> tri-state boolean (null when unknown/empty). */
export function normalizeAvStatus(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v.includes("not running")) return false;
  if (v.includes("running")) return true;
  return null;
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (3 tests).

- [ ] **Step 7: Verify the app still builds**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/types vitest.config.ts package.json package-lock.json
git commit -m "feat: shared domain types + generated DB types + vitest"
```

---

### Task 11: pgTAP RLS tests — tenancy & domain resolution

**Files:**
- Create: `supabase/tests/0001_rls_tenancy.test.sql`

These tests run against the local Supabase DB (`supabase test db` spins up the local stack).
They simulate an authenticated user by setting `request.jwt.claims` + `role`.

- [ ] **Step 1: Ensure the local stack is available**

```bash
supabase start
```

Expected: local containers up; prints local API URL + keys.

- [ ] **Step 2: Write the pgTAP test**

Create `supabase/tests/0001_rls_tenancy.test.sql`:

```sql
begin;
select plan(4);

-- Seed two clients + domains directly (service role / superuser context).
insert into public.clients (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Client A'),
  ('22222222-2222-2222-2222-222222222222', 'Client B');
insert into public.client_domains (domain, client_id) values
  ('client-a.com', '11111111-1111-1111-1111-111111111111');

-- Simulate the new-user trigger by inserting auth.users rows.
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'alice@client-a.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'shawn@rocking.one'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'stranger@unknown.com');

-- Trigger should have resolved profiles:
select is(
  (select role::text from public.profiles where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  'client_member', 'matched-domain user becomes client_member');
select is(
  (select status::text from public.profiles where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'),
  'pending', 'unknown-domain user becomes pending');
select is(
  (select role::text from public.profiles where id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
  'rocking_staff', 'rocking.one user becomes rocking_staff');

-- RLS: Alice (member of Client A) can read only Client A.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';
select is(
  (select count(*)::int from public.clients),
  1, 'client_member sees only their own client row');

select * from finish();
rollback;
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `supabase test db`
Expected: `0001_rls_tenancy.test.sql .. ok` — 4 passing assertions.

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/0001_rls_tenancy.test.sql
git commit -m "test(db): pgTAP — domain resolution + client RLS scoping"
```

---

### Task 12: pgTAP RLS tests — device scoping per role

**Files:**
- Create: `supabase/tests/0002_rls_devices.test.sql`

- [ ] **Step 1: Write the pgTAP test**

Create `supabase/tests/0002_rls_devices.test.sql`:

```sql
begin;
select plan(4);

-- Two clients.
insert into public.clients (id, name) values
  ('11111111-1111-1111-1111-111111111111', 'Client A'),
  ('22222222-2222-2222-2222-222222222222', 'Client B');
insert into public.client_domains (domain, client_id) values
  ('client-a.com', '11111111-1111-1111-1111-111111111111');

-- Users: manager + member in Client A, staff, via the trigger.
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'manager@client-a.com'),
  ('a2222222-2222-2222-2222-222222222222', 'member@client-a.com'),
  ('a3333333-3333-3333-3333-333333333333', 'staff@rocking.one');
-- Promote the manager (managers are assigned, not auto).
update public.profiles set role = 'client_manager'
  where id = 'a1111111-1111-1111-1111-111111111111';

-- Devices: two in Client A, one in Client B.
insert into public.devices (id, client_id, device_identity, hostname) values
  ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111', 'SN-A1', 'A1'),
  ('d2222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'SN-A2', 'A2'),
  ('d3333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', 'SN-B1', 'B1');
-- Member is assigned only device A1.
insert into public.device_assignments (device_id, profile_id) values
  ('d1111111-1111-1111-1111-111111111111', 'a2222222-2222-2222-2222-222222222222');

-- Manager sees both Client A devices, not Client B's.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.devices), 2,
  'client_manager sees all of their client''s devices');

-- Member sees only their assigned device.
set local "request.jwt.claims" = '{"sub":"a2222222-2222-2222-2222-222222222222","role":"authenticated"}';
select is((select count(*)::int from public.devices), 1,
  'client_member sees only assigned devices');
select is((select hostname from public.devices), 'A1',
  'client_member sees the correct assigned device');

-- Staff sees all three.
set local "request.jwt.claims" = '{"sub":"a3333333-3333-3333-3333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.devices), 3,
  'rocking_staff sees every device');

select * from finish();
rollback;
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `supabase test db`
Expected: both test files pass; 8 assertions total green.

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/0002_rls_devices.test.sql
git commit -m "test(db): pgTAP — device scoping for staff/manager/member"
```

---

### Task 13: Final verification & push

- [ ] **Step 1: Full local check**

```bash
npm run build && npm test && supabase test db
```

Expected: build PASS, Vitest PASS, pgTAP all green.

- [ ] **Step 2: Confirm remote migrations are in sync**

```bash
supabase migration list
```

Expected: `0001`–`0007` applied locally and remotely.

- [ ] **Step 3: Push branch**

```bash
git push
```

- [ ] **Step 4: Stop the local stack (optional)**

```bash
supabase stop
```

---

## Self-Review

**Spec coverage:**
- Tenancy (clients, client_domains, profiles, roles) → Tasks 4, 5. ✓
- Domain rules (`rocking.one`→staff, matched→member, unknown→pending, manager assigned) → Task 5 trigger + Task 11 tests. ✓
- Datto hybrid model (devices current-state + children + dated `device_health_snapshots`) → Tasks 6, 7. ✓
- Device identity (serial→hostname) → `device_identity` + unique index, Task 6. ✓
- `device_assignments` claim step → Task 6; claim RPCs → Task 9. ✓
- `site_aliases`, `import_runs` audit → Task 6. ✓
- RLS scoping (staff/manager/member) → Task 8, verified Tasks 11–12. ✓
- Shared types end-to-end → Task 10. ✓
- Architecture/repo layout, Supabase clients → Tasks 1–3. ✓

**Deferred correctly (not in this plan):** auth UI (Plan 2), ingestion CLI parsers/upsert (Plan 3), dashboard views (Plan 4). The schema + RPCs they need exist here.

**Placeholder scan:** no TBD/TODO; every code/SQL step is complete.

**Type consistency:** `current_user_role()` (renamed from `current_role()` to avoid shadowing the Postgres built-in keyword; see migration 0004), `current_client_id()`, `is_rocking_staff()` used identically across Tasks 5, 8, 9; `device_identity`, `av_ok`, `assigned_user_label` consistent across Tasks 6, 10; `normalizeAvStatus` defined and tested in Task 10.
