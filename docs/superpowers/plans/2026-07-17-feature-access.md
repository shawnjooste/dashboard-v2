# Per-User Feature Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers (or any client user) can have sections unticked per-user — nav hides them, pages redirect, and for Billing/Quotes the database itself refuses rows.

**Architecture:** `profiles.feature_overrides jsonb` holds subtractive overrides; a pure `feature-access` helper resolves role defaults + overrides; the client layout passes the allowed set into AppShell nav filtering; gated pages/actions check server-side; a `has_feature()` SECURITY DEFINER function joins the client-read RLS policies on the money tables. Admin edits overrides on the Users page.

**Tech Stack:** Next.js 16, Supabase Postgres/RLS, vitest.

**Spec:** `docs/superpowers/specs/2026-07-17-feature-access-design.md`

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs` (verify before push). Commands from repo root.
- Features: exactly `billing`, `quotes`, `team`, `devices`, `m365`, `network`. Home + Support never gated.
- Role defaults: `client_manager` → all six; `client_member` → none; `rocking_staff` → bypass everything.
- Overrides are subtractive only; stored overrides contain only `false` values; all-default saves as null.
- RLS enforcement v1: billing (`xero_invoices`, `client_billing`) and quotes (`quotes`, `quote_versions`, `quote_events`) client-read policies. Other sections page+nav only (documented cut).
- `/devices/[id]` stays ungated (members reach their own machine there; RLS scopes rows) — only the fleet list `/devices` is gated.
- Pure helpers import-free (vitest-safe). Quote parenthesized paths. Stale `.git/index.lock` → remove, retry.
- The RLS/security diff gets an adversarial review subagent before push.

---

### Task 1: Pure helper + tests (TDD)

**Files:** Create `lib/feature-access.ts`, test `lib/feature-access.test.ts`.

**Interfaces (produced):**
- `FEATURES: readonly string[]` (the six keys, display order)
- `FEATURE_LABELS: Record<string, string>`
- `FEATURE_HREFS: Record<string, string>` — `{ billing: "/billing", quotes: "/quotes", team: "/team", devices: "/devices", m365: "/m365", network: "/network" }`
- `type Overrides = Record<string, boolean> | null`
- `canAccess(role: string, overrides: Overrides, feature: string): boolean`
- `allowedFeatures(role: string, overrides: Overrides): Set<string>`
- `overridesFromSelection(role: string, selected: Set<string>): Record<string, false> | null` (admin save: only differences from role defaults; empty → null)

- [ ] **Step 1: failing test** — `lib/feature-access.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FEATURES, allowedFeatures, canAccess, overridesFromSelection } from "./feature-access";

describe("canAccess", () => {
  it("staff always passes", () => {
    expect(canAccess("rocking_staff", { billing: false }, "billing")).toBe(true);
  });
  it("manager defaults to everything", () => {
    for (const f of FEATURES) expect(canAccess("client_manager", null, f)).toBe(true);
  });
  it("member defaults to nothing", () => {
    for (const f of FEATURES) expect(canAccess("client_member", null, f)).toBe(false);
  });
  it("an override subtracts from a manager", () => {
    expect(canAccess("client_manager", { billing: false }, "billing")).toBe(false);
    expect(canAccess("client_manager", { billing: false }, "quotes")).toBe(true);
  });
  it("unknown features are denied for clients", () => {
    expect(canAccess("client_manager", null, "nonsense")).toBe(false);
  });
});

describe("allowedFeatures", () => {
  it("reflects overrides", () => {
    const set = allowedFeatures("client_manager", { team: false });
    expect(set.has("team")).toBe(false);
    expect(set.has("billing")).toBe(true);
  });
});

describe("overridesFromSelection", () => {
  it("stores only unticked defaults", () => {
    const sel = new Set(FEATURES.filter((f) => f !== "billing"));
    expect(overridesFromSelection("client_manager", sel)).toEqual({ billing: false });
  });
  it("all defaults → null", () => {
    expect(overridesFromSelection("client_manager", new Set(FEATURES))).toBeNull();
  });
  it("members always resolve to null in v1 (subtractive only)", () => {
    expect(overridesFromSelection("client_member", new Set())).toBeNull();
  });
});
```

- [ ] **Step 2:** `npx vitest run lib/feature-access.test.ts` → FAIL (module missing).
- [ ] **Step 3: implement** — `lib/feature-access.ts`:

```ts
/** Pure per-user feature-access logic — no server imports (vitest-safe). */

export const FEATURES = ["billing", "quotes", "team", "devices", "m365", "network"] as const;

export const FEATURE_LABELS: Record<string, string> = {
  billing: "Billing",
  quotes: "Quotes",
  team: "Team",
  devices: "Devices",
  m365: "Microsoft 365",
  network: "Network",
};

/** Nav href each feature gates (Home and Support are never gated). */
export const FEATURE_HREFS: Record<string, string> = {
  billing: "/billing",
  quotes: "/quotes",
  team: "/team",
  devices: "/devices",
  m365: "/m365",
  network: "/network",
};

export type Overrides = Record<string, boolean> | null;

const MANAGER_DEFAULTS = new Set<string>(FEATURES);
const MEMBER_DEFAULTS = new Set<string>();

/** Role defaults minus per-user false overrides. Staff bypasses everything. */
export function canAccess(role: string, overrides: Overrides, feature: string): boolean {
  if (role === "rocking_staff") return true;
  const defaults = role === "client_manager" ? MANAGER_DEFAULTS : MEMBER_DEFAULTS;
  if (!defaults.has(feature)) return false;
  return overrides?.[feature] !== false;
}

export function allowedFeatures(role: string, overrides: Overrides): Set<string> {
  return new Set(FEATURES.filter((f) => canAccess(role, overrides, f)));
}

/** Admin save: keep only defaults the admin unticked; nothing unticked → null. */
export function overridesFromSelection(role: string, selected: Set<string>): Record<string, false> | null {
  const defaults = role === "client_manager" ? MANAGER_DEFAULTS : MEMBER_DEFAULTS;
  const out: Record<string, false> = {};
  for (const f of defaults) if (!selected.has(f)) out[f] = false;
  return Object.keys(out).length ? out : null;
}
```

- [ ] **Step 4:** helper tests + `npm test` green.
- [ ] **Step 5:** commit `feat(access): pure feature-access helpers`.

---

### Task 2: Migration — overrides column, has_feature(), RLS on money tables

**Files:** Create `supabase/migrations/0048_feature_access.sql`; regen `lib/types/database.ts`.

- [ ] **Step 1: migration**

```sql
-- Per-user feature access: role gives defaults, feature_overrides subtracts
-- (e.g. {"billing": false} on a manager). Staff bypass in app code; RLS below
-- enforces the money sections at the database.
alter table public.profiles add column feature_overrides jsonb;

-- Does the CALLER have this feature? Mirrors lib/feature-access.ts:
-- staff always; manager unless overridden false; member never (v1 defaults).
create or replace function public.has_feature(p_feature text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.is_rocking_staff() then true
    when public.current_user_role() = 'client_manager' then
      coalesce((select (feature_overrides ->> p_feature)::boolean
                  from public.profiles where id = auth.uid()), true)
    else false
  end;
$$;
grant execute on function public.has_feature(text) to authenticated;

-- Billing: client read now also requires the billing feature.
drop policy xero_invoices_read on public.xero_invoices;
create policy xero_invoices_read on public.xero_invoices
  for select using (
    public.is_rocking_staff()
    or (client_id = public.current_client_id() and public.has_feature('billing'))
  );
drop policy client_billing_read on public.client_billing;
create policy client_billing_read on public.client_billing
  for select using (
    public.is_rocking_staff()
    or (client_id = public.current_client_id() and public.has_feature('billing'))
  );
```

plus, for each of the three quotes client-read policies in `0022_quotes.sql`
(`quotes_manager_select`, `quote_versions_manager_select`,
`quote_events_manager_select` — confirm exact names with
`grep "create policy" supabase/migrations/0022_quotes.sql` before writing):
drop and recreate identically with ` and public.has_feature('quotes')`
appended inside the manager branch. (The recreation must copy each policy's
existing USING body verbatim from 0022 — read them first.)

- [ ] **Step 2:** verify ref → `npx supabase db push --linked` → applied.
- [ ] **Step 3:** regen types; `npx tsc --noEmit` clean.
- [ ] **Step 4:** commit `feat(access): feature_overrides + has_feature RLS on billing/quotes`.

---

### Task 3: Plumb the allowed set into nav

**Files:** Modify `lib/auth/profile.ts` (select + expose `feature_overrides`), `app/(app)/layout.tsx` (compute allowed set), `components/AppShell.tsx` (filter by feature hrefs).

- [ ] **Step 1:** In `lib/auth/profile.ts`, add `feature_overrides` to the profile select and its type (read the file; it selects specific columns today).
- [ ] **Step 2:** In `app/(app)/layout.tsx`: `import { allowedFeatures, FEATURE_HREFS } from "@/lib/feature-access";` then compute
`const allowed = allowedFeatures(me.profile.role, me.profile.feature_overrides);`
and pass `allowedHrefs={[...allowed].map((f) => FEATURE_HREFS[f])}` to `AppShell` (keep `billingEnabled` behavior: billing shows only if allowed AND xero-linked).
- [ ] **Step 3:** In `components/AppShell.tsx`, replace the billing-only filter with: gated hrefs = the six FEATURE_HREFS values; an item whose href is gated renders only if it's in `allowedHrefs` (and `/billing` additionally requires `billingEnabled`). Non-gated items always render.
- [ ] **Step 4:** `npm run build` clean; commit `feat(access): nav filtered by allowed features`.

---

### Task 4: Page + action guards

**Files:** Modify `app/(app)/billing/page.tsx`, `app/(app)/quotes/page.tsx`, `app/(app)/quotes/[id]/page.tsx` (+ quote client actions file if present), `app/(app)/team/page.tsx`, `app/(app)/team/actions.ts`, `app/(app)/devices/page.tsx`, `app/(app)/m365/page.tsx`, `app/(app)/network/page.tsx`.

- [ ] **Step 1:** Add to each gated page, after the profile fetch (pattern):

```ts
import { canAccess } from "@/lib/feature-access";
// …
if (!canAccess(me.profile.role, me.profile.feature_overrides, "billing")) redirect("/");
```

(feature key per page; pages that don't currently fetch the profile get the fetch added — read each file first). `/devices/[id]` is intentionally left ungated.
- [ ] **Step 2:** Same check at the top of `inviteTeamMember` (feature `team`) and any client quote actions (feature `quotes`) — return the action's error shape, not redirect, where the action returns state.
- [ ] **Step 3:** `npm run build` clean; commit `feat(access): server-side page and action guards`.

---

### Task 5: Admin Access editor on the Users page

**Files:** Read `app/(admin)/admin/users/UsersView.tsx` + `page.tsx` first; create `app/(admin)/admin/users/AccessEditor.tsx`; modify `app/(admin)/admin/users/actions.ts` (+ view query to include `feature_overrides`).

- [ ] **Step 1: action** — append to `app/(admin)/admin/users/actions.ts`:

```ts
export async function saveFeatureOverrides(formData: FormData) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  const profileId = String(formData.get("profile_id") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!profileId) throw new Error("invalid request");
  const selected = new Set(FEATURES.filter((f) => formData.get(`f_${f}`) === "on"));
  const overrides = overridesFromSelection(role, selected);
  const { error } = await createServiceClient()
    .from("profiles")
    .update({ feature_overrides: overrides })
    .eq("id", profileId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/users");
}
```

with imports `FEATURES, overridesFromSelection` from `@/lib/feature-access`.
- [ ] **Step 2: editor component** — `AccessEditor.tsx`: a server-component form per user row (collapsible `<details>` to stay light): six checkboxes `name="f_<feature>"` defaultChecked from `canAccess(role, overrides, f)`, hidden `profile_id` + `role`, Save button posting `saveFeatureOverrides`. Members render it disabled (informational). Match FIELD/button styles used elsewhere.
- [ ] **Step 3:** Wire into `UsersView` rows (read its structure; add an "Access" column or row-expansion) and include `feature_overrides` in the page's profile query.
- [ ] **Step 4:** `npm run build`; commit `feat(access): per-user Access editor on Users page`.

---

### Task 6: Verify (incl. real-JWT RLS test) + adversarial review + push

- [ ] **Step 1:** `npm test && npm run build` green.
- [ ] **Step 2: real-token RLS proof** (script, service key): create throwaway auth user `rls-test@rocking-internal.test` with a random password; set profile → GSR client, `client_manager`, active, `feature_overrides = {"billing": false, "quotes": false}`; sign in via GoTrue password grant with the ANON key to get a real user JWT; with that JWT: `xero_invoices` select → **0 rows**, `quotes` select → **0 rows**; clear overrides → both return rows (GSR has both); delete the test user. Print each step's counts.
- [ ] **Step 3:** Dispatch an adversarial review subagent over the full diff (spec + `git diff` range) focused on: has_feature correctness (member branch, null override, SECURITY DEFINER search_path), policy recreation fidelity vs 0022 originals, guard coverage gaps, and whether any un-gated API path still exposes billing/quotes to a restricted manager. Fix Critical/Important findings, re-review.
- [ ] **Step 4:** Push; deploy spot-check: restricted-manager nav via impersonation.
