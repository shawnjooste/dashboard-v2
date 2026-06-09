# Auth & Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Passwordless email login, post-auth role/status routing, a pending-user holding state with admin approval, and device claiming — all enforcing the tenancy/RLS foundation from Plan 1.

**Architecture:** Next.js App Router with `@supabase/ssr` cookie sessions refreshed in middleware. Login is Supabase email OTP (6-digit code). A server helper loads the caller's `profiles` row; a pure `resolveLandingPath()` maps role+status+claim-state to a destination. Route groups gate access: client surface (`(app)`), admin surface (`(admin)`), and unauthenticated (`(auth)`). Pending users (unknown email domain) get a holding screen; a staff-only `approve_pending_user` RPC assigns them to a client and flips status to active **atomically** (per Plan 1 carry-forward note #1). Device claiming uses the `claimable_devices()` / `claim_device()` RPCs from Plan 1.

**Tech Stack:** Next.js 16 (App Router, Server Components, Server Actions), `@supabase/ssr`, Supabase email OTP, Resend SMTP, Vitest. Supabase project `eskhokedsximnslgsycs`.

---

## Scope (Plan 2 of 4 for Slice 1)

**In:** Resend SMTP wiring for auth email; passwordless login (email → code); session middleware; `getCurrentProfile()`; pure `resolveLandingPath()`; route gating for `(auth)`/`(app)`/`(admin)`; pending holding screen; device-claim onboarding; admin pending-approval list + atomic `approve_pending_user` RPC; sign-out.

**Out (later/CLI):**
- Creating clients + client_domains + site_aliases — done by the agent via CLI when loading data, not a UI.
- Manager role-management (promote member, assign device to member) — Plan 4 (views).
- Dashboard device views — Plan 4.
- Magic-link (we use 6-digit code; link can be added later).

## Prerequisites / environment

- Plan 1 complete: migrations 0001–0011 applied; `current_user_role()`/`current_client_id()`/`is_rocking_staff()`, `claimable_devices()`/`claim_device()` exist.
- `.env.local` has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`, `RESEND_API_KEY`.
- Resend domain `send.rocking.one` is verified in Resend.
- No Docker locally → DB-level tests are verified via rolled-back `supabase db query --linked` transactions (as in Plan 1); pgTAP files are added for CI.

## File Structure

```
middleware.ts                              # root middleware → session refresh
lib/supabase/middleware.ts                 # updateSession(request) helper
lib/auth/profile.ts                        # getCurrentProfile() (server) + types
lib/auth/routing.ts                        # resolveLandingPath() PURE fn
lib/auth/__tests__/routing.test.ts         # Vitest unit tests for routing
app/(auth)/login/page.tsx                  # email + code form (client component)
app/(auth)/login/actions.ts                # requestCode / verifyCode server actions
app/auth/signout/route.ts                  # POST → sign out → redirect /login
app/(app)/layout.tsx                       # gate: load profile, redirect per resolveLandingPath
app/(app)/page.tsx                         # placeholder client dashboard (real in Plan 4)
app/(app)/pending/page.tsx                 # holding screen for pending users
app/(app)/onboarding/page.tsx             # "claim your machine" (server: claimable_devices)
app/(app)/onboarding/actions.ts            # claimDevice server action (claim_device RPC)
app/(admin)/layout.tsx                     # gate: staff-only
app/(admin)/admin/page.tsx                 # placeholder admin home (real in Plan 4)
app/(admin)/admin/pending/page.tsx         # list pending users + approve form
app/(admin)/admin/pending/actions.ts       # approvePendingUser server action
supabase/migrations/0012_approve_user_rpc.sql
supabase/tests/0003_approve_user.test.sql  # pgTAP for the approval RPC (CI)
```

**Responsibility boundaries:** session plumbing in `lib/supabase/middleware.ts`; identity loading in `lib/auth/profile.ts`; routing *decision* is a pure function in `lib/auth/routing.ts` (the only heavily unit-tested piece); UI components stay thin and delegate to server actions.

---

### Task 1: Configure Resend SMTP for Supabase Auth

Supabase's built-in mailer only sends to project members and is rate-limited; real client logins need custom SMTP. Resend is the provider (domain `send.rocking.one`).

**Files:** none in-repo (remote Auth config); record the values used in a committed doc note.

- [ ] **Step 1: Determine the Resend SMTP credentials**

Resend SMTP host/port/user are fixed; the password is the Resend API key:
- Host: `smtp.resend.com`
- Port: `465` (SSL) or `587` (STARTTLS) — use `465`
- Username: `resend`
- Password: the `RESEND_API_KEY` value from `.env.local`
- Sender: `no-reply@send.rocking.one`, sender name `Rocking`

- [ ] **Step 2: Apply SMTP config to the remote project**

Preferred: set via the Supabase dashboard (Auth → Emails/SMTP Settings → enable custom SMTP) using the values above. If you can apply it via the Management API / `supabase` CLI auth-config push instead, do so. Whichever path: enable custom SMTP and set sender `no-reply@send.rocking.one`.

> If neither CLI nor Management API can set SMTP for the hosted project, STOP and report what's needed — this step may require the human to toggle it in the dashboard. Provide the exact field values above so they can do it in under a minute.

- [ ] **Step 3: Verify delivery**

Trigger an OTP to a real inbox you control (e.g. `jooste@gmail.com`): in the dashboard Auth → Users → "Send magic link", or via the app once Task 4 exists. Confirm an email arrives from `no-reply@send.rocking.one`. Record success.

- [ ] **Step 4: Document**

Append a short section to `docs/superpowers/plans/2026-06-09-auth-and-onboarding.md` under a "## SMTP configuration (as applied)" heading noting host/port/user/sender and how it was applied. Commit:

```bash
git add docs/superpowers/plans/2026-06-09-auth-and-onboarding.md
git commit -m "docs(auth): record Resend SMTP configuration for auth email"
```

---

### Task 2: Session middleware

**Files:**
- Create: `lib/supabase/middleware.ts`, `middleware.ts`

- [ ] **Step 1: Session-refresh helper**

Create `lib/supabase/middleware.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Touch the user to refresh the token cookie. Do not gate routing here;
  // route groups handle authorization.
  await supabase.auth.getUser();
  return response;
}
```

- [ ] **Step 2: Root middleware**

Create `middleware.ts`:

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/middleware.ts middleware.ts
git commit -m "feat(auth): session-refresh middleware"
```

---

### Task 3: Profile loader + pure routing decision (TDD)

**Files:**
- Create: `lib/auth/profile.ts`, `lib/auth/routing.ts`
- Test: `lib/auth/__tests__/routing.test.ts`

- [ ] **Step 1: Write the failing test for `resolveLandingPath`**

Create `lib/auth/__tests__/routing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveLandingPath, type RouteInput } from "../routing";

const base: RouteInput = {
  authenticated: true,
  role: "client_member",
  status: "active",
  hasClient: true,
  hasClaimedDevice: true,
};

describe("resolveLandingPath", () => {
  it("sends unauthenticated users to /login", () => {
    expect(resolveLandingPath({ ...base, authenticated: false })).toBe("/login");
  });

  it("sends rocking staff to /admin", () => {
    expect(resolveLandingPath({ ...base, role: "rocking_staff", hasClient: false })).toBe("/admin");
  });

  it("sends pending users to /pending", () => {
    expect(resolveLandingPath({ ...base, status: "pending", hasClient: false })).toBe("/pending");
  });

  it("sends active members with no claimed device to onboarding", () => {
    expect(resolveLandingPath({ ...base, hasClaimedDevice: false })).toBe("/onboarding");
  });

  it("sends fully-onboarded members to /app", () => {
    expect(resolveLandingPath(base)).toBe("/app");
  });

  it("sends managers to /app regardless of personal device claim", () => {
    expect(resolveLandingPath({ ...base, role: "client_manager", hasClaimedDevice: false })).toBe("/app");
  });
});
```

- [ ] **Step 2: Run the test — verify it FAILS**

Run: `npm test`
Expected: FAIL — cannot find `../routing`.

- [ ] **Step 3: Implement `lib/auth/routing.ts`**

```ts
import type { UserRole, ProfileStatus } from "@/lib/types/domain";

export type RouteInput = {
  authenticated: boolean;
  role: UserRole;
  status: ProfileStatus;
  hasClient: boolean;
  hasClaimedDevice: boolean;
};

/**
 * Pure decision: where should this caller land? Order matters.
 * - unauthenticated      -> /login
 * - rocking_staff        -> /admin
 * - pending / no client  -> /pending
 * - active member, no claimed device -> /onboarding
 * - everyone else active -> /app
 */
export function resolveLandingPath(input: RouteInput): string {
  if (!input.authenticated) return "/login";
  if (input.role === "rocking_staff") return "/admin";
  if (input.status === "pending" || !input.hasClient) return "/pending";
  if (input.role === "client_member" && !input.hasClaimedDevice) return "/onboarding";
  return "/app";
}
```

- [ ] **Step 4: Run the test — verify it PASSES**

Run: `npm test`
Expected: PASS (6 new assertions).

- [ ] **Step 5: Implement the profile loader**

Create `lib/auth/profile.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types/domain";

export type CurrentProfile =
  | { authenticated: false }
  | { authenticated: true; profile: Profile; hasClaimedDevice: boolean };

/** Loads the caller's profile + whether they have any claimed device. */
export async function getCurrentProfile(): Promise<CurrentProfile> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { authenticated: false };

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // Authenticated but no profile row yet (trigger race). Treat as pending.
    return {
      authenticated: true,
      profile: {
        id: user.id,
        email: user.email ?? "",
        client_id: null,
        role: "client_member",
        status: "pending",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      hasClaimedDevice: false,
    };
  }

  const { count } = await supabase
    .from("device_assignments")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", user.id);

  return { authenticated: true, profile, hasClaimedDevice: (count ?? 0) > 0 };
}
```

- [ ] **Step 6: Run tests + build**

Run: `npm test` (PASS) then `npm run build` (PASS).

- [ ] **Step 7: Commit**

```bash
git add lib/auth
git commit -m "feat(auth): getCurrentProfile loader + pure resolveLandingPath (tested)"
```

---

### Task 4: Login page + OTP server actions

**Files:**
- Create: `app/(auth)/login/actions.ts`, `app/(auth)/login/page.tsx`

- [ ] **Step 1: Server actions**

Create `app/(auth)/login/actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export type ActionState = { error?: string; codeSent?: boolean; email?: string };

export async function requestCode(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) return { error: error.message, email };
  return { codeSent: true, email };
}

export async function verifyCode(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: "Enter the 6-digit code.", codeSent: true, email };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email",
  });
  if (error) return { error: error.message, codeSent: true, email };

  // Session cookie is set; send to the root gate which routes by profile.
  redirect("/");
}
```

- [ ] **Step 2: Login UI**

Create `app/(auth)/login/page.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { requestCode, verifyCode, type ActionState } from "./actions";

const initial: ActionState = {};

export default function LoginPage() {
  const [reqState, reqAction] = useActionState(requestCode, initial);
  const [verState, verAction] = useActionState(verifyCode, initial);
  const sent = reqState.codeSent;
  const email = reqState.email ?? "";

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-2xl font-semibold">Sign in to Rocking</h1>

        {!sent ? (
          <form action={reqAction} className="space-y-4">
            <label className="block text-sm font-medium">Email address</label>
            <input
              name="email"
              type="email"
              required
              autoFocus
              className="w-full rounded border px-3 py-2"
              placeholder="you@company.com"
            />
            {reqState.error && (
              <p className="text-sm text-red-600">{reqState.error}</p>
            )}
            <button className="w-full rounded bg-black px-3 py-2 text-white">
              Email me a code
            </button>
          </form>
        ) : (
          <form action={verAction} className="space-y-4">
            <p className="text-sm text-gray-600">
              We sent a 6-digit code to <strong>{email}</strong>.
            </p>
            <input type="hidden" name="email" value={email} />
            <label className="block text-sm font-medium">6-digit code</label>
            <input
              name="token"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              required
              autoFocus
              className="w-full rounded border px-3 py-2 tracking-widest"
              placeholder="123456"
            />
            {verState.error && (
              <p className="text-sm text-red-600">{verState.error}</p>
            )}
            <button className="w-full rounded bg-black px-3 py-2 text-white">
              Verify &amp; sign in
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Manual verification (record result)**

Run `npm run dev`, open `/login`, enter your email, confirm the code email arrives (depends on Task 1 SMTP), enter the code, confirm you're redirected to `/`. Record outcome. If SMTP isn't live yet, note that and proceed (the flow is testable once Task 1 lands).

- [ ] **Step 5: Commit**

```bash
git add "app/(auth)"
git commit -m "feat(auth): passwordless login (email + 6-digit code)"
```

---

### Task 5: Sign-out route

**Files:**
- Create: `app/auth/signout/route.ts`

- [ ] **Step 1: Route handler**

Create `app/auth/signout/route.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
```

- [ ] **Step 2: Build + commit**

Run: `npm run build` (PASS).

```bash
git add app/auth/signout/route.ts
git commit -m "feat(auth): sign-out route"
```

---

### Task 6: Client surface gate + placeholder + pending screen

**Files:**
- Create: `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `app/(app)/pending/page.tsx`

- [ ] **Step 1: Client-surface layout gate**

Create `app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { resolveLandingPath } from "@/lib/auth/routing";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role === "rocking_staff") redirect("/admin");
  return <>{children}</>;
}
```

- [ ] **Step 2: Placeholder dashboard**

Create `app/(app)/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { resolveLandingPath } from "@/lib/auth/routing";

export default async function AppHome() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  const path = resolveLandingPath({
    authenticated: true,
    role: me.profile.role,
    status: me.profile.status,
    hasClient: me.profile.client_id !== null,
    hasClaimedDevice: me.hasClaimedDevice,
  });
  if (path !== "/app") redirect(path);

  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Your dashboard</h1>
      <p className="mt-2 text-gray-600">Device views arrive in the next slice.</p>
      <form action="/auth/signout" method="post" className="mt-6">
        <button className="rounded border px-3 py-1 text-sm">Sign out</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Pending holding screen**

Create `app/(app)/pending/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";

export default async function PendingPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  // If they've since been assigned a client, bounce them onward.
  if (me.profile.status === "active" && me.profile.client_id) redirect("/");

  return (
    <main className="flex min-h-screen items-center justify-center p-6 text-center">
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-semibold">We&apos;re setting up your access</h1>
        <p className="text-gray-600">
          Your account <strong>{me.profile.email}</strong> isn&apos;t linked to a
          client yet. Rocking has been notified and will connect you shortly.
        </p>
        <form action="/auth/signout" method="post">
          <button className="rounded border px-3 py-1 text-sm">Sign out</button>
        </form>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Build + commit**

Run: `npm run build` (PASS).

```bash
git add "app/(app)/layout.tsx" "app/(app)/page.tsx" "app/(app)/pending/page.tsx"
git commit -m "feat(app): client gate, placeholder dashboard, pending screen"
```

---

### Task 7: Device-claim onboarding

**Files:**
- Create: `app/(app)/onboarding/actions.ts`, `app/(app)/onboarding/page.tsx`

- [ ] **Step 1: Claim server action**

Create `app/(app)/onboarding/actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export async function claimDevice(formData: FormData) {
  const deviceId = String(formData.get("device_id") ?? "");
  if (!deviceId) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_device", { p_device_id: deviceId });
  if (error) throw new Error(error.message);
  redirect("/app");
}
```

- [ ] **Step 2: Onboarding page (lists claimable devices via RPC)**

Create `app/(app)/onboarding/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { claimDevice } from "./actions";

export default async function OnboardingPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.status !== "active" || !me.profile.client_id) redirect("/pending");
  if (me.hasClaimedDevice) redirect("/app");

  const supabase = await createClient();
  const { data: devices } = await supabase.rpc("claimable_devices");

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold">Claim your machine</h1>
      <p className="mt-2 text-gray-600">
        Pick the computer that&apos;s yours so we can show you its health.
      </p>
      <ul className="mt-6 space-y-2">
        {(devices ?? []).map((d: { id: string; hostname: string; assigned_user_label: string | null }) => (
          <li key={d.id}>
            <form action={claimDevice}>
              <input type="hidden" name="device_id" value={d.id} />
              <button className="flex w-full items-center justify-between rounded border px-4 py-3 text-left hover:bg-gray-50">
                <span className="font-medium">{d.hostname}</span>
                <span className="text-sm text-gray-500">
                  {d.assigned_user_label ?? "unassigned"}
                </span>
              </button>
            </form>
          </li>
        ))}
        {(!devices || devices.length === 0) && (
          <li className="text-gray-500">
            No unclaimed machines found for your company yet. Check back soon.
          </li>
        )}
      </ul>
      <form action="/auth/signout" method="post" className="mt-8">
        <button className="rounded border px-3 py-1 text-sm">Sign out</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `npm run build` (PASS).

```bash
git add "app/(app)/onboarding"
git commit -m "feat(app): device-claim onboarding via claimable_devices/claim_device"
```

---

### Task 8: Atomic pending-user approval RPC (DB)

**Files:**
- Create: `supabase/migrations/0012_approve_user_rpc.sql`, `supabase/tests/0003_approve_user.test.sql`

Honors Plan 1 carry-forward note #1: set `client_id` **and** flip `status` to active in one statement, staff-only.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0012_approve_user_rpc.sql`:

```sql
-- Staff-only: assign a pending user to a client and activate them atomically.
-- Enforces that only rocking_staff may call it, and that the target client exists.
create or replace function public.approve_pending_user(
  p_profile_id uuid,
  p_client_id  uuid,
  p_make_manager boolean default false
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_rocking_staff() then
    raise exception 'only rocking staff may approve users';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id) then
    raise exception 'client does not exist';
  end if;

  update public.profiles
     set client_id = p_client_id,
         status    = 'active',
         role      = case when p_make_manager then 'client_manager'::public.user_role
                          else role end
   where id = p_profile_id;

  if not found then
    raise exception 'profile not found';
  end if;
end;
$$;

revoke all on function public.approve_pending_user(uuid, uuid, boolean) from public, anon;
grant execute on function public.approve_pending_user(uuid, uuid, boolean) to authenticated;
```

- [ ] **Step 2: Push**

```bash
export SUPABASE_DB_PASSWORD="$(grep SUPABASE_DB_PASSWORD .env.local | cut -d= -f2)"
supabase db push
```

Expected: applies `0012`.

- [ ] **Step 3: Verify with a rolled-back remote probe**

Write to `/tmp/approve_probe.sql` and run `supabase db query --linked -f /tmp/approve_probe.sql`:

```sql
begin;
insert into public.clients (id, name) values ('33333333-3333-3333-3333-333333333333','Approve Co');
insert into auth.users (id, email) values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','new@unknown-x.com');
-- trigger made a pending profile; approve it as if staff:
update public.profiles set role='rocking_staff', status='active', client_id=null
  where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';  -- TEMP make this row staff to satisfy is_rocking_staff()? No—use a separate staff caller.
rollback;
```

> NOTE for the implementer: `is_rocking_staff()` keys off `auth.uid()`, so to exercise the RPC properly you must simulate a STAFF caller. Do it like the Plan 1 probes: seed a `rocking.one` auth user (becomes staff via trigger), seed a separate pending user + a client, then `set local role authenticated` + `set local request.jwt.claims` to the STAFF user's sub, and `select public.approve_pending_user('<pending-id>','<client-id>', false);` then assert the pending profile is now `status='active'` with the right `client_id`. Also assert a NON-staff caller gets the 'only rocking staff' exception. Roll back. Capture and report the assertion outputs.

- [ ] **Step 4: pgTAP test for CI**

Create `supabase/tests/0003_approve_user.test.sql`:

```sql
begin;
select plan(3);

insert into public.clients (id, name) values
  ('33333333-3333-3333-3333-333333333333', 'Approve Co');
insert into auth.users (id, email) values
  ('f1111111-1111-1111-1111-111111111111', 'staff@rocking.one'),
  ('f2222222-2222-2222-2222-222222222222', 'pending@unknown-x.com');

-- As staff: approve the pending user into the client.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.approve_pending_user('f2222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333', false) $$,
  'staff can approve a pending user');

reset role;
select is(
  (select status::text from public.profiles where id = 'f2222222-2222-2222-2222-222222222222'),
  'active', 'approved user is now active');
select is(
  (select client_id::text from public.profiles where id = 'f2222222-2222-2222-2222-222222222222'),
  '33333333-3333-3333-3333-333333333333', 'approved user is linked to the client');

select * from finish();
rollback;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0012_approve_user_rpc.sql supabase/tests/0003_approve_user.test.sql
git commit -m "feat(db): approve_pending_user RPC (atomic assign + activate, staff-only)"
```

---

### Task 9: Admin surface gate + pending-approval UI

**Files:**
- Create: `app/(admin)/layout.tsx`, `app/(admin)/admin/page.tsx`, `app/(admin)/admin/pending/page.tsx`, `app/(admin)/admin/pending/actions.ts`

- [ ] **Step 1: Admin gate**

Create `app/(admin)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "rocking_staff") redirect("/");
  return <>{children}</>;
}
```

- [ ] **Step 2: Admin placeholder home**

Create `app/(admin)/admin/page.tsx`:

```tsx
import Link from "next/link";

export default function AdminHome() {
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Rocking admin</h1>
      <ul className="mt-4 list-disc pl-5">
        <li>
          <Link className="underline" href="/admin/pending">
            Pending user approvals
          </Link>
        </li>
      </ul>
      <p className="mt-4 text-gray-600">Client dashboards arrive in the next slice.</p>
      <form action="/auth/signout" method="post" className="mt-6">
        <button className="rounded border px-3 py-1 text-sm">Sign out</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Approval server action**

Create `app/(admin)/admin/pending/actions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export async function approveUser(formData: FormData) {
  const profileId = String(formData.get("profile_id") ?? "");
  const clientId = String(formData.get("client_id") ?? "");
  const makeManager = formData.get("make_manager") === "on";
  if (!profileId || !clientId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_pending_user", {
    p_profile_id: profileId,
    p_client_id: clientId,
    p_make_manager: makeManager,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/pending");
}
```

- [ ] **Step 4: Approval page**

Create `app/(admin)/admin/pending/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";
import { approveUser } from "./actions";

export default async function PendingApprovalsPage() {
  const supabase = await createClient();
  const [{ data: pending }, { data: clients }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase.from("clients").select("id, name").order("name"),
  ]);

  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Pending user approvals</h1>
      {(!pending || pending.length === 0) && (
        <p className="mt-4 text-gray-600">No pending users.</p>
      )}
      <ul className="mt-6 space-y-4">
        {(pending ?? []).map((p) => (
          <li key={p.id} className="rounded border p-4">
            <div className="font-medium">{p.email}</div>
            <form action={approveUser} className="mt-3 flex flex-wrap items-center gap-3">
              <input type="hidden" name="profile_id" value={p.id} />
              <select name="client_id" required className="rounded border px-2 py-1">
                <option value="">Choose a client…</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="make_manager" /> Make manager
              </label>
              <button className="rounded bg-black px-3 py-1 text-sm text-white">
                Approve
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 5: Build + commit + push**

Run: `npm run build` (PASS).

```bash
git add "app/(admin)"
git commit -m "feat(admin): pending-user approval UI"
git push
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Static checks**

Run: `npm run build && npm test && npx tsc --noEmit && npm run lint`
Expected: all PASS.

- [ ] **Step 2: DB checks**

Run: `supabase migration list` → expect 0001–0012 Local AND Remote.
Run the rolled-back approval probe from Task 8 → expect staff-approval activates the user; non-staff is rejected.

- [ ] **Step 3: Manual auth walkthrough (record results)**

With SMTP live (Task 1): from `npm run dev`, (a) sign in with a `@rocking.one` email → land on `/admin`; (b) sign in with an unknown-domain email → land on `/pending`, see it listed under `/admin/pending`, approve it to a seeded client → on next load that user lands on `/onboarding` (or `/app` if no devices); (c) sign out works. Record outcomes; if a step depends on seeded data/devices not yet loaded, note it.

- [ ] **Step 4: Final commit (if any docs/notes) + push**

```bash
git push
```

---

## SMTP configuration (as applied)

Applied via `supabase config push` (no dashboard toggle needed) on 2026-06-09. Set in
`supabase/config.toml`:

- `[auth.email.smtp]` enabled, `host=smtp.resend.com`, `port=465`, `user=resend`,
  `pass=env(RESEND_API_KEY)`, `admin_email=no-reply@send.rocking.one`, `sender_name=Rocking`.
- `[auth.email]` `otp_length=6`, `enable_confirmations=false` (OTP signs in directly),
  `max_frequency=1s`.
- `[auth.rate_limit]` `email_sent=60` per hour (raised from the template default of 2).

Verified: `POST /auth/v1/otp` for a real address returned HTTP 200 and delivered a code from
`no-reply@send.rocking.one`. `config.toml` commits the `env(RESEND_API_KEY)` reference, never the
key itself. When the app is deployed, update `[auth] site_url` from `http://127.0.0.1:3000` to the
Vercel URL and re-push.

## Self-Review

**Spec coverage (design Section 5 + carry-forward notes):**
- Passwordless email login → Tasks 1 (SMTP), 4 (OTP). ✓
- Post-auth resolver routing (rocking.one→staff, matched→member, unknown→pending) → Task 3 pure fn + DB trigger from Plan 1; gates in Tasks 6, 9. ✓
- Pending holding screen + admin assignment request surface → Tasks 6, 9. ✓
- Atomic assign + activate (carry-forward #1) → Task 8 RPC (`client_id` + `status` set together). ✓
- Device claiming via RPCs → Task 7. ✓
- Sign out → Task 5. ✓
- Session handling → Task 2. ✓

**Deferred correctly:** client/domain creation (agent CLI), manager promote/assign (Plan 4), magic-link.

**Placeholder scan:** no TBD/TODO; all code complete. The only non-code step is Task 1 (remote SMTP) which may need a human dashboard toggle — explicitly flagged.

**Type consistency:** `resolveLandingPath`/`RouteInput` consistent across Tasks 3, 6; `getCurrentProfile`/`CurrentProfile` consistent across Tasks 3, 6, 7, 9; RPC arg names (`p_profile_id`, `p_client_id`, `p_make_manager`, `p_device_id`) match the SQL signatures in Task 8 and Plan 1.
