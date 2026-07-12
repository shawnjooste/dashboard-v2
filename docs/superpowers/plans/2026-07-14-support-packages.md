# Support Packages & Gating (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The portal knows each client's support package and gates the `/support` experience accordingly, with a portal-owned time ledger and admin tooling to run it.

**Architecture:** Three new tables (`support_packages` seeded with Free / Business Care / Partner, package + plan-label columns on `clients`, `support_time_entries` ledger). Pure helpers compute month usage and package resolution; a view layer feeds both the admin surfaces and the gated client `/support` page; staff-guarded server actions do all writes. FreeScout stays a dumb channel — portal tickets get a `tier:<key>` tag so priority is visible where the team works.

**Tech Stack:** Next.js 16 App Router (server components + actions), Supabase Postgres/RLS, vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-support-packages-design.md`

## Global Constraints

- Supabase project ref is `eskhokedsximnslgsycs` (dashboard-v2) — never `qomxwxxulxcwnpaqzudl`. Verify `cat supabase/.temp/project-ref` before any db push.
- All commands from repo root `/Users/shawnjooste/Documents/Claude/dashboard-v2`.
- Migrations `npx supabase db push --linked`; types `npx supabase gen types typescript --linked > lib/types/database.ts`.
- Pure helpers live in their own import-free file (vitest must not pull `@/lib/supabase/server`).
- Package assignment and time entries are **staff-only writes**. Clients read their own. Managers may NOT edit packages (unlike device disposition).
- Seed placeholders: free 0 min / no SLA, business_care 300 min / 8 h, partner 600 min / 4 h. Real numbers are data, edited in the admin UI.
- Design tokens/components as used across the repo (`Card`, `CardHeader`, `PageHeader` from `@/components/ui`; `FIELD` input style as in `DeviceChangeLog.tsx`).
- Quote parenthesized paths in shell (`"app/(app)/support/page.tsx"`).
- If git hangs on `.git/index.lock`, remove the stale lock (Cursor's git worker) and retry.

---

### Task 1: Pure helpers + tests (TDD)

The math and resolution logic everything else leans on — month windowing, usage sums, meter formatting, default-package resolution.

**Files:**
- Create: `lib/support-package-helpers.ts`
- Test: `lib/support-package-helpers.test.ts`

**Interfaces:**
- Produces (Tasks 3–6 import these): `monthKey(d: Date): string`; `usedMinutesInMonth(entries: { occurred_on: string; minutes: number }[], key: string): number`; `fmtMinutes(mins: number): string`; `resolvePackage<T extends { id: string; is_default: boolean }>(packages: T[], clientPackageId: string | null): T | null`.

- [ ] **Step 1: Write the failing test**

`lib/support-package-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fmtMinutes, monthKey, resolvePackage, usedMinutesInMonth } from "./support-package-helpers";

describe("monthKey", () => {
  it("formats a date as YYYY-MM", () => {
    expect(monthKey(new Date("2026-07-14T10:00:00Z"))).toBe("2026-07");
  });
  it("pads single-digit months", () => {
    expect(monthKey(new Date("2026-03-31T23:00:00Z"))).toBe("2026-03");
  });
});

describe("usedMinutesInMonth", () => {
  const entries = [
    { occurred_on: "2026-07-01", minutes: 30 },
    { occurred_on: "2026-07-14", minutes: 45 },
    { occurred_on: "2026-06-30", minutes: 500 },
  ];
  it("sums only the given month", () => {
    expect(usedMinutesInMonth(entries, "2026-07")).toBe(75);
  });
  it("is zero for an empty month", () => {
    expect(usedMinutesInMonth(entries, "2026-01")).toBe(0);
  });
});

describe("fmtMinutes", () => {
  it("formats whole hours", () => {
    expect(fmtMinutes(300)).toBe("5h");
  });
  it("formats hours and minutes", () => {
    expect(fmtMinutes(320)).toBe("5h 20m");
  });
  it("formats minutes only", () => {
    expect(fmtMinutes(45)).toBe("45m");
  });
  it("formats zero", () => {
    expect(fmtMinutes(0)).toBe("0m");
  });
});

describe("resolvePackage", () => {
  const pkgs = [
    { id: "a", is_default: true },
    { id: "b", is_default: false },
  ];
  it("returns the assigned package", () => {
    expect(resolvePackage(pkgs, "b")?.id).toBe("b");
  });
  it("falls back to the default when unassigned", () => {
    expect(resolvePackage(pkgs, null)?.id).toBe("a");
  });
  it("falls back to the default when the id is stale", () => {
    expect(resolvePackage(pkgs, "gone")?.id).toBe("a");
  });
  it("returns null when there are no packages at all", () => {
    expect(resolvePackage([], null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/support-package-helpers.test.ts`
Expected: FAIL — cannot resolve `./support-package-helpers`.

- [ ] **Step 3: Write minimal implementation**

`lib/support-package-helpers.ts`:

```ts
/** Pure support-package logic — no server imports (vitest-safe). */

/** "YYYY-MM" for the month containing d (UTC). */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Sum of minutes for entries whose occurred_on date falls in the keyed month. */
export function usedMinutesInMonth(
  entries: { occurred_on: string; minutes: number }[],
  key: string,
): number {
  return entries.filter((e) => e.occurred_on.startsWith(key)).reduce((n, e) => n + e.minutes, 0);
}

/** 320 → "5h 20m"; 300 → "5h"; 45 → "45m". */
export function fmtMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** The client's assigned package, else the default package, else null. */
export function resolvePackage<T extends { id: string; is_default: boolean }>(
  packages: T[],
  clientPackageId: string | null,
): T | null {
  return (
    (clientPackageId && packages.find((p) => p.id === clientPackageId)) ||
    packages.find((p) => p.is_default) ||
    null
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/support-package-helpers.test.ts` → 11 pass. Then `npm test` → whole suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/support-package-helpers.ts lib/support-package-helpers.test.ts
git commit -m "feat(support-packages): pure month/usage/resolution helpers"
```

---

### Task 2: Migration — packages, client columns, time ledger, RLS

**Files:**
- Create: `supabase/migrations/0044_support_packages.sql`
- Modify: `lib/types/database.ts` (regenerated)

**Interfaces:**
- Produces: tables `support_packages` (seeded), `support_time_entries`; `clients.support_package_id` + `clients.support_plan_label`. Tasks 3–6 read/write these.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0044_support_packages.sql`:

```sql
-- Support packages: the portal-owned tier each client is on. The portal is
-- the gate — FreeScout/Crisp stay dumb channels. Assignment is STAFF-ONLY
-- (clients never set their own tier; managers may not either).
create table public.support_packages (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique check (key in ('free','business_care','partner')),
  name             text not null,
  rank             int  not null default 0,
  included_minutes int  not null default 0,
  sla_hours        int,
  has_chat         boolean not null default false,
  remote_included  boolean not null default false,
  is_default       boolean not null default false
);

insert into public.support_packages (key, name, rank, included_minutes, sla_hours, has_chat, remote_included, is_default) values
  ('free',          'Standard',      0, 0,    null, false, false, true),
  ('business_care', 'Business Care', 1, 300,  8,    false, true,  false),
  ('partner',       'Partner',       2, 600,  4,    true,  true,  false);

alter table public.clients
  add column support_package_id uuid references public.support_packages(id) on delete set null,
  add column support_plan_label text;

-- Portal-owned time ledger (NOT FreeScout's module). Month usage is computed
-- at read time from occurred_on — no reset job.
create table public.support_time_entries (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  minutes           int  not null check (minutes > 0),
  work_type         text not null default 'ticket'
                      check (work_type in ('ticket','remote','onsite','other')),
  note              text,
  freescout_number  int,
  entered_by        uuid references public.profiles(id) on delete set null,
  occurred_on       date not null default current_date,
  created_at        timestamptz not null default now()
);
create index support_time_entries_client_idx on public.support_time_entries (client_id, occurred_on);

alter table public.support_packages enable row level security;
alter table public.support_time_entries enable row level security;

-- Packages are effectively the price list: any signed-in user may read.
create policy support_packages_read on public.support_packages
  for select to authenticated using (true);
create policy support_packages_staff on public.support_packages
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Ledger: staff everything; a client's users may READ their own entries
-- (transparency makes the hours meter trustworthy at invoice time).
create policy support_time_entries_staff on public.support_time_entries
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy support_time_entries_client_read on public.support_time_entries
  for select using (client_id = public.current_client_id());
```

- [ ] **Step 2: Push (verify ref first)**

Run: `cat supabase/.temp/project-ref` → must print `eskhokedsximnslgsycs`. Then `npx supabase db push --linked`.
Expected: "Applying migration 0044_support_packages.sql... Finished".

- [ ] **Step 3: Regenerate types + typecheck**

Run: `npx supabase gen types typescript --linked > lib/types/database.ts && npx tsc --noEmit`
Expected: `support_packages` / `support_time_entries` in the types; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0044_support_packages.sql lib/types/database.ts
git commit -m "feat(support-packages): tables, seeds, client columns, RLS"
```

---

### Task 3: View layer + staff actions

**Files:**
- Create: `lib/views/support-packages.ts`
- Create: `lib/actions/support-packages.ts`

**Interfaces:**
- Consumes: Task 1 helpers; Task 2 tables.
- Produces:
  - `type SupportPackage = { id: string; key: string; name: string; rank: number; includedMinutes: number; slaHours: number | null; hasChat: boolean; remoteIncluded: boolean; isDefault: boolean }`
  - `type SupportStatus = { pkg: SupportPackage | null; planLabel: string | null; usedMinutes: number }`
  - `getSupportPackages(): Promise<SupportPackage[]>`
  - `getSupportStatus(clientId: string): Promise<SupportStatus>`
  - `type TimeEntry = { id: string; minutes: number; workType: string; note: string | null; freescoutNumber: number | null; author: string | null; occurredOn: string }`
  - `getTimeEntries(clientId: string, key: string): Promise<TimeEntry[]>` (entries in the keyed month, newest first)
  - Actions: `savePackage(formData)`, `assignClientPackage(clientId, formData)`, `addTimeEntry(clientId, formData)`, `deleteTimeEntry(entryId, clientId)` — all staff-guarded.

- [ ] **Step 1: Write the view layer**

`lib/views/support-packages.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { monthKey, resolvePackage, usedMinutesInMonth } from "@/lib/support-package-helpers";

export type SupportPackage = {
  id: string;
  key: string;
  name: string;
  rank: number;
  includedMinutes: number;
  slaHours: number | null;
  hasChat: boolean;
  remoteIncluded: boolean;
  isDefault: boolean;
};

export type SupportStatus = {
  pkg: SupportPackage | null;
  planLabel: string | null;
  usedMinutes: number;
};

export type TimeEntry = {
  id: string;
  minutes: number;
  workType: string;
  note: string | null;
  freescoutNumber: number | null;
  author: string | null;
  occurredOn: string;
};

const toPkg = (r: {
  id: string; key: string; name: string; rank: number; included_minutes: number;
  sla_hours: number | null; has_chat: boolean; remote_included: boolean; is_default: boolean;
}): SupportPackage => ({
  id: r.id,
  key: r.key,
  name: r.name,
  rank: r.rank,
  includedMinutes: r.included_minutes,
  slaHours: r.sla_hours,
  hasChat: r.has_chat,
  remoteIncluded: r.remote_included,
  isDefault: r.is_default,
});

export async function getSupportPackages(): Promise<SupportPackage[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_packages")
    .select("id, key, name, rank, included_minutes, sla_hours, has_chat, remote_included, is_default")
    .order("rank");
  return (data ?? []).map(toPkg);
}

/** Package + plan label + current-month usage for one client. RLS scopes
 *  every query: clients see only their own row/entries, staff see all. */
export async function getSupportStatus(clientId: string): Promise<SupportStatus> {
  const supabase = await createClient();
  const key = monthKey(new Date());
  const [packages, clientRow, entries] = await Promise.all([
    getSupportPackages(),
    supabase.from("clients").select("support_package_id, support_plan_label").eq("id", clientId).maybeSingle(),
    supabase.from("support_time_entries").select("occurred_on, minutes").eq("client_id", clientId).gte("occurred_on", `${key}-01`),
  ]);
  return {
    pkg: resolvePackage(packages, clientRow.data?.support_package_id ?? null),
    planLabel: clientRow.data?.support_plan_label ?? null,
    usedMinutes: usedMinutesInMonth(entries.data ?? [], key),
  };
}

/** This month's ledger entries for a client, newest first. */
export async function getTimeEntries(clientId: string, key: string): Promise<TimeEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_time_entries")
    .select("id, minutes, work_type, note, freescout_number, entered_by, occurred_on")
    .eq("client_id", clientId)
    .gte("occurred_on", `${key}-01`)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });
  const { data: profiles } = await supabase.from("profiles").select("id, email");
  const email = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const label = (id: string | null) => {
    const e = id ? email.get(id) : null;
    return e ? e.split("@")[0].replace(/[._]/g, " ") : null;
  };
  return (data ?? []).map((e) => ({
    id: e.id,
    minutes: e.minutes,
    workType: e.work_type,
    note: e.note,
    freescoutNumber: e.freescout_number,
    author: label(e.entered_by),
    occurredOn: e.occurred_on,
  }));
}
```

- [ ] **Step 2: Write the staff actions**

`lib/actions/support-packages.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};

/** Edit a package's display name, allowance, SLA and flags (data, not code). */
export async function savePackage(formData: FormData) {
  await staff();
  const id = String(formData.get("id") ?? "");
  const name = str(formData, "name");
  const hours = Number(formData.get("included_hours") ?? 0);
  const sla = str(formData, "sla_hours");
  if (!id || !name || !Number.isFinite(hours) || hours < 0) throw new Error("invalid package");
  const supabase = await createClient();
  const { error } = await supabase
    .from("support_packages")
    .update({
      name,
      included_minutes: Math.round(hours * 60),
      sla_hours: sla ? Number(sla) : null,
      has_chat: formData.get("has_chat") === "on",
      remote_included: formData.get("remote_included") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/support-packages");
}

/** Assign a client's package + plan label. Staff-only by guard AND by using
 *  the service client — clients.support_* columns have no client-write path. */
export async function assignClientPackage(clientId: string, formData: FormData) {
  await staff();
  const packageId = str(formData, "package_id");
  const service = createServiceClient();
  const { error } = await service
    .from("clients")
    .update({ support_package_id: packageId, support_plan_label: str(formData, "plan_label") })
    .eq("id", clientId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/support");
}

export async function addTimeEntry(clientId: string, formData: FormData) {
  const me = await staff();
  const minutes = Number(formData.get("minutes"));
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("minutes must be positive");
  const workType = String(formData.get("work_type") ?? "ticket");
  const fsNum = str(formData, "freescout_number");
  const supabase = await createClient();
  const { error } = await supabase.from("support_time_entries").insert({
    client_id: clientId,
    minutes: Math.round(minutes),
    work_type: ["ticket", "remote", "onsite", "other"].includes(workType) ? workType : "other",
    note: str(formData, "note"),
    freescout_number: fsNum ? Number(fsNum) : null,
    entered_by: me.id,
    occurred_on: str(formData, "occurred_on") ?? undefined,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin/support-packages");
}

export async function deleteTimeEntry(entryId: string, clientId: string) {
  await staff();
  const supabase = await createClient();
  await supabase.from("support_time_entries").delete().eq("id", entryId);
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin/support-packages");
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 4: Commit**

```bash
git add lib/views/support-packages.ts lib/actions/support-packages.ts
git commit -m "feat(support-packages): view layer + staff actions"
```

---

### Task 4: Admin packages page + nav

**Files:**
- Create: `app/(admin)/admin/support-packages/page.tsx`
- Modify: `lib/nav.ts` (add to rocking_staff Business group)

**Interfaces:**
- Consumes: `getSupportPackages`, `savePackage` (Task 3), `fmtMinutes` (Task 1).
- Produces: `/admin/support-packages` — edit the three tiers + current-month burn table across clients.

- [ ] **Step 1: Write the page**

`app/(admin)/admin/support-packages/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getSupportPackages } from "@/lib/views/support-packages";
import { savePackage } from "@/lib/actions/support-packages";
import { fmtMinutes, monthKey, usedMinutesInMonth } from "@/lib/support-package-helpers";
import { Card, CardHeader, PageHeader } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

export default async function SupportPackagesPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const supabase = await createClient();
  const key = monthKey(new Date());
  const [packages, clientsRes, entriesRes] = await Promise.all([
    getSupportPackages(),
    supabase.from("clients").select("id, name, support_package_id, support_plan_label").order("name"),
    supabase.from("support_time_entries").select("client_id, occurred_on, minutes").gte("occurred_on", `${key}-01`),
  ]);
  const clients = clientsRes.data ?? [];
  const entries = entriesRes.data ?? [];
  const pkgById = new Map(packages.map((p) => [p.id, p]));
  // Clients on a paid tier, plus any client with logged time this month.
  const activeIds = new Set(entries.map((e) => e.client_id));
  const rows = clients
    .filter((c) => (c.support_package_id && !pkgById.get(c.support_package_id)?.isDefault) || activeIds.has(c.id))
    .map((c) => {
      const pkg = (c.support_package_id && pkgById.get(c.support_package_id)) || packages.find((p) => p.isDefault) || null;
      const used = usedMinutesInMonth(entries.filter((e) => e.client_id === c.id), key);
      return { id: c.id, name: c.name, pkg, label: c.support_plan_label, used };
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Support packages"
        subtitle="The tiers clients can be on, and who's burning hours this month. Allowances here are data — edit freely."
      />

      <Card>
        <CardHeader title="Packages" count={packages.length} />
        {packages.map((p) => {
          const save = savePackage;
          return (
            <form key={p.id} action={save} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5 last:border-0">
              <input type="hidden" name="id" value={p.id} />
              <span className="w-28 shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-center text-[11px] font-medium text-ink-3">{p.key}</span>
              <input name="name" defaultValue={p.name} className={`${FIELD} w-40`} />
              <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <input name="included_hours" type="number" step="0.5" min="0" defaultValue={p.includedMinutes / 60} className={`${FIELD} w-20`} />
                hrs/month
              </label>
              <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <input name="sla_hours" type="number" min="0" defaultValue={p.slaHours ?? ""} placeholder="—" className={`${FIELD} w-20`} />
                hr response
              </label>
              <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <input type="checkbox" name="has_chat" defaultChecked={p.hasChat} /> chat
              </label>
              <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
                <input type="checkbox" name="remote_included" defaultChecked={p.remoteIncluded} /> remote incl.
              </label>
              <button className="ml-auto rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
                Save
              </button>
            </form>
          );
        })}
      </Card>

      <Card>
        <CardHeader title={`This month (${key})`} count={rows.length} />
        {rows.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted">No clients on paid tiers or logged time yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                <th className="px-4 py-2.5 font-semibold">Package</th>
                <th className="px-4 py-2.5 font-semibold">Used</th>
                <th className="px-4 py-2.5 font-semibold">Included</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const over = r.pkg && r.pkg.includedMinutes > 0 && r.used > r.pkg.includedMinutes;
                return (
                  <tr key={r.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                    <td className="px-4 py-2.5 font-medium text-ink">{r.name}</td>
                    <td className="px-4 py-2.5 text-ink-2">
                      {r.pkg?.name ?? "—"}
                      {r.label ? <span className="text-muted"> · {r.label}</span> : null}
                    </td>
                    <td className={`px-4 py-2.5 ${over ? "font-semibold text-brand" : "text-ink-2"}`}>{fmtMinutes(r.used)}</td>
                    <td className="px-4 py-2.5 text-muted">{r.pkg && r.pkg.includedMinutes > 0 ? fmtMinutes(r.pkg.includedMinutes) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Add the nav item**

In `lib/nav.ts`, rocking_staff → Business group, after Jobs:

```ts
        { label: "Support packages", href: "/admin/support-packages" },
```

- [ ] **Step 3: Build**

Run: `npm run build` → compiles; `/admin/support-packages` in the route list.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/support-packages/page.tsx" lib/nav.ts
git commit -m "feat(support-packages): admin packages page + burn table"
```

---

### Task 5: Client-page assignment + time log

**Files:**
- Create: `app/(admin)/admin/clients/[id]/SupportSection.tsx`
- Modify: `app/(admin)/admin/clients/[id]/page.tsx` (render it)

**Interfaces:**
- Consumes: `getSupportPackages`, `getSupportStatus`, `getTimeEntries` (Task 3 views); `assignClientPackage`, `addTimeEntry`, `deleteTimeEntry` (Task 3 actions); `fmtMinutes`, `monthKey` (Task 1).
- Produces: `<SupportSection clientId={string} />` on the admin client page.

- [ ] **Step 1: Write the section component**

`app/(admin)/admin/clients/[id]/SupportSection.tsx`:

```tsx
import { getSupportPackages, getSupportStatus, getTimeEntries } from "@/lib/views/support-packages";
import { assignClientPackage, addTimeEntry, deleteTimeEntry } from "@/lib/actions/support-packages";
import { fmtMinutes, monthKey } from "@/lib/support-package-helpers";
import { Card, CardHeader } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";
const WORK_TYPES = ["ticket", "remote", "onsite", "other"] as const;

/** Staff-only: this client's package, plan label, and the month's time log. */
export async function SupportSection({ clientId }: { clientId: string }) {
  const key = monthKey(new Date());
  const [packages, status, entries] = await Promise.all([
    getSupportPackages(),
    getSupportStatus(clientId),
    getTimeEntries(clientId, key),
  ]);
  const assign = assignClientPackage.bind(null, clientId);
  const add = addTimeEntry.bind(null, clientId);
  const included = status.pkg?.includedMinutes ?? 0;

  return (
    <Card>
      <CardHeader
        title="Support"
        count={included > 0 ? `${fmtMinutes(status.usedMinutes)} of ${fmtMinutes(included)} used` : fmtMinutes(status.usedMinutes)}
      />

      <form action={assign} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5">
        <select name="package_id" defaultValue={status.pkg?.id ?? ""} className={FIELD}>
          {packages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          name="plan_label"
          defaultValue={status.planLabel ?? ""}
          placeholder='Plan label (optional), e.g. "Managed IT bundle"'
          className={`${FIELD} min-w-0 flex-1`}
        />
        <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
          Save
        </button>
      </form>

      <form action={add} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5">
        <input name="minutes" type="number" min="1" required placeholder="Minutes" className={`${FIELD} w-24`} />
        <select name="work_type" defaultValue="ticket" className={FIELD}>
          {WORK_TYPES.map((t) => (
            <option key={t} value={t}>
              {t[0].toUpperCase() + t.slice(1)}
            </option>
          ))}
        </select>
        <input name="occurred_on" type="date" className={FIELD} />
        <input name="freescout_number" type="number" placeholder="Ticket #" className={`${FIELD} w-28`} />
        <input name="note" placeholder="What was done?" className={`${FIELD} min-w-0 flex-1`} />
        <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
          Log time
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No time logged this month.</p>
      ) : (
        <ul>
          {entries.map((e) => {
            const remove = deleteTimeEntry.bind(null, e.id, clientId);
            return (
              <li key={e.id} className="flex items-start gap-2.5 border-b border-line-soft px-4 py-3 last:border-0">
                <span className="mt-0.5 w-16 shrink-0 text-right font-medium text-ink">{fmtMinutes(e.minutes)}</span>
                <span className="mt-0.5 shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-3">
                  {e.workType}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{e.note ?? "—"}</p>
                  <p className="mt-0.5 text-xs text-faint">
                    {e.occurredOn}
                    {e.freescoutNumber ? ` · #${e.freescoutNumber}` : ""}
                    {e.author ? <span className="capitalize"> · {e.author}</span> : ""}
                  </p>
                </div>
                <form action={remove} className="shrink-0">
                  <button className="text-xs text-faint hover:text-brand" title="Delete entry">
                    Remove
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Render it on the admin client page**

In `app/(admin)/admin/clients/[id]/page.tsx`: `import { SupportSection } from "./SupportSection";` and render `<SupportSection clientId={id} />` directly after the `SummaryStrip` (before the device table), using the page's existing client id variable.

- [ ] **Step 3: Build**

Run: `npm run build` → clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/clients/[id]/SupportSection.tsx" "app/(admin)/admin/clients/[id]/page.tsx"
git commit -m "feat(support-packages): client assignment + time log on admin client page"
```

---

### Task 6: The gate — tiered client `/support` + FreeScout tier tag

**Files:**
- Create: `components/SupportTierBanner.tsx`
- Modify: `app/(app)/support/page.tsx` (render banner; tier-aware subtitle)
- Modify: `lib/freescout.ts` (optional `tags` on `createTicket`)
- Modify: `app/(app)/support/actions.ts` (tag portal tickets with the tier)

**Interfaces:**
- Consumes: `getSupportStatus` (Task 3), `fmtMinutes` (Task 1), `getCurrentProfile`.
- Produces: the visible gate. `createTicket(opts: { email; subject; message; tags?: string[] })`.

- [ ] **Step 1: Write the tier banner**

`components/SupportTierBanner.tsx`:

```tsx
import { getCurrentProfile } from "@/lib/auth/profile";
import { getSupportStatus } from "@/lib/views/support-packages";
import { fmtMinutes } from "@/lib/support-package-helpers";
import { Card } from "@/components/ui";

/** The gate's face: what support the signed-in client's package gets them.
 *  Free → best-effort framing + upgrade card. Care/Partner → hours meter
 *  (managers only) + SLA copy. A plan label reframes the tier as part of a
 *  bundle ("Support is included in your Managed IT plan"). */
export async function SupportTierBanner() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role === "rocking_staff" || !me.profile.client_id) return null;
  const status = await getSupportStatus(me.profile.client_id);
  const pkg = status.pkg;
  if (!pkg) return null;

  const isManager = me.profile.role === "client_manager";
  const heading = status.planLabel
    ? `Support is included in your ${status.planLabel}`
    : pkg.isDefault
      ? "Standard support"
      : `${pkg.name} support`;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3.5">
          <div>
            <div className="font-semibold text-ink">{heading}</div>
            <p className="text-[13px] text-muted">
              {pkg.isDefault
                ? "We respond as capacity allows. Need guaranteed response times or included hours? Ask us about Business Care."
                : pkg.slaHours
                  ? `Priority handling — first response within ${pkg.slaHours} business hours.`
                  : "Priority handling."}
            </p>
          </div>
          {!pkg.isDefault && pkg.includedMinutes > 0 && isManager && (
            <div className="ml-auto text-right">
              <div className="text-[13px] font-semibold text-ink">
                {fmtMinutes(status.usedMinutes)} of {fmtMinutes(pkg.includedMinutes)}
              </div>
              <div className="text-xs text-faint">support hours used this month</div>
            </div>
          )}
          {pkg.hasChat && (
            <span className="rounded-full bg-brand-tint px-2.5 py-1 text-xs font-semibold text-brand">
              Live chat — coming soon
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Render it on `/support`**

In `app/(app)/support/page.tsx`: `import { SupportTierBanner } from "@/components/SupportTierBanner";` and render `<SupportTierBanner />` directly under the `<PageHeader …>` block, before the tickets card.

- [ ] **Step 3: Add tags to `createTicket`**

In `lib/freescout.ts`, change the signature and body:

```ts
export async function createTicket(opts: {
  email: string;
  subject: string;
  message: string;
  tags?: string[];
}): Promise<number> {
  const res = await fsFetch(`/conversations`, {
    method: "POST",
    body: JSON.stringify({
      type: "email",
      mailboxId: PORTAL_MAILBOX_ID,
      subject: opts.subject,
      customer: { email: opts.email },
      threads: [{ type: "customer", text: opts.message, customer: { email: opts.email } }],
      status: "active",
      ...(opts.tags?.length ? { tags: opts.tags } : {}),
    }),
  });
  if (!res.ok) throw new Error(`FreeScout create failed (${res.status})`);
  const data = await res.json();
  return data.id as number;
}
```

- [ ] **Step 4: Tag portal tickets with the tier**

In `app/(app)/support/actions.ts`, inside `createTicketAction`, after the scope check:

```ts
  // Stamp the client's tier on the ticket so priority is visible in FreeScout.
  let tags: string[] | undefined;
  const me = await getCurrentProfile();
  if (me.authenticated && me.profile.client_id) {
    const status = await getSupportStatus(me.profile.client_id);
    if (status.pkg) tags = [`tier:${status.pkg.key}`];
  }

  let id: number;
  try {
    id = await createTicket({ email: scope.email, subject, message, tags });
  } catch {
    return { error: "Couldn't create the ticket right now. Please try again shortly." };
  }
```

with imports added at the top: `import { getCurrentProfile } from "@/lib/auth/profile";` and `import { getSupportStatus } from "@/lib/views/support-packages";`.

- [ ] **Step 5: Tests + build**

Run: `npm test && npm run build` → suite green, build clean.

- [ ] **Step 6: Commit**

```bash
git add components/SupportTierBanner.tsx "app/(app)/support/page.tsx" lib/freescout.ts "app/(app)/support/actions.ts"
git commit -m "feat(support-packages): gated /support with tier banner + FreeScout tier tags"
```

---

### Task 7: Verify end-to-end + push

- [ ] **Step 1:** `npm test && npm run build` — all green.
- [ ] **Step 2:** Staff path: open `/admin/support-packages`, edit an allowance, save; assign a test client (e.g. JoosteCo) to Business Care with label "Managed IT bundle"; log a 45-minute entry; burn table shows the client.
- [ ] **Step 3:** Client path: as a manager of that client, `/support` shows the plan-label heading + hours meter; as a member, banner shows but no meter; a Free-tier client sees the upgrade framing. Raise a test portal ticket → confirm `tier:` tag on the conversation in FreeScout.
- [ ] **Step 4:** RLS spot-check via anon/manager tokens: manager cannot update `clients.support_package_id` or insert `support_time_entries`; client selects only own entries.
- [ ] **Step 5:** `git push origin main`; spot-check production.
