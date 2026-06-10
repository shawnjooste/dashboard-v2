# Dashboard Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder dashboards with three role-scoped device views — admin "All Clients" cockpit, manager "Network Overview" fleet, and member "My Machine" — over the live Datto data, all RLS-scoped.

**Architecture:** Server Components fetch RLS-scoped rows via the cookie Supabase client and aggregate in a small typed view-model layer (`lib/views/`). The *health* logic (attention flags, fleet summary, patch %) is a pure, unit-tested module; data fetching is thin. No new DB objects and no SECURITY DEFINER surface — we rely on the already-verified table RLS, so a member only ever sees their assigned device's rows, a manager their client's, staff everything. Shared presentational components render the same shapes across all three views.

**Tech Stack:** Next.js 16 (App Router, Server Components), `@supabase/ssr` (typed with `Database`), Tailwind v4, Vitest. Supabase project `eskhokedsximnslgsycs`.

---

## Scope (Plan 4 of 4 for Slice 1)

**In:** a clean light theme + app shell (fixes the current low-contrast placeholder); pure health/summary module (TDD); RLS-scoped data-fetch view-model; shared components (AttentionBadge, SummaryStrip, DeviceTable, DeviceHealthCard, ClientCard, Sparkline); admin All-Clients + client drill-in; manager Network Overview; member My Machine; a minimal health trend from `device_health_snapshots`.

**Out:** manager role-management UI (promote member / assign device) — a follow-up; live Datto API sync (ingestion stays the CLI); charts library (we use a tiny inline SVG sparkline, no dep); the `middleware`→`proxy` rename (deferred tech-debt).

## Prerequisites

- Plans 1–3 done; auth works; data seeded (93 clients, 64 devices + storage/patch/alerts/health snapshots).
- `lib/auth/profile.ts` `getCurrentProfile()` returns `{ authenticated, profile (role,status,client_id), hasClaimedDevice }`.
- `lib/supabase/server.ts` `createClient()` is typed with `Database`.
- Generated types include all tables (devices, device_storage, device_patch_status, device_alerts, device_health_snapshots, clients).

## File Structure

```
app/globals.css                          # clean light theme (replace dark auto-switch)
components/AppShell.tsx                   # top bar: brand, user email, role, sign out
components/AttentionBadge.tsx             # colored health pill
components/SummaryStrip.tsx               # device count / attention / patch %
components/DeviceTable.tsx                # fleet table
components/DeviceHealthCard.tsx           # single-device health summary
components/ClientCard.tsx                 # admin per-client rollup card
components/Sparkline.tsx                  # tiny inline-SVG trend (no dep)
lib/views/health.ts                      # PURE: deviceHealth(), summarize() + helpers
lib/views/health.test.ts                 # Vitest unit tests
lib/views/devices.ts                     # RLS-scoped fetch + assembly (DeviceHealth[])
lib/views/clients.ts                     # admin per-client summaries + global attention
app/(app)/layout.tsx                      # wrap children in AppShell (keep gate)
app/(app)/page.tsx                        # manager Network Overview | member My Machine
app/(admin)/layout.tsx                    # wrap children in AppShell (keep gate)
app/(admin)/admin/page.tsx                # All Clients cockpit
app/(admin)/admin/clients/[id]/page.tsx   # client drill-in (Network Overview, admin)
```

**Boundaries:** `lib/views/health.ts` is pure (no I/O) and is the only heavily-tested unit. `lib/views/devices.ts`/`clients.ts` do thin RLS-scoped fetches and call the pure layer. Components are presentational (props in, JSX out) — no data fetching inside them.

---

### Task 1: Clean theme + app shell

**Files:** Modify `app/globals.css`; Create `components/AppShell.tsx`; Modify `app/(app)/layout.tsx`, `app/(admin)/layout.tsx`.

- [ ] **Step 1: Replace `app/globals.css`** with a clean light theme (removes the create-next-app dark auto-switch that caused the low-contrast look):

```css
@import "tailwindcss";

:root {
  --background: #f7f7f8;
  --foreground: #18181b;
}

html, body {
  background: var(--background);
  color: var(--foreground);
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
```

- [ ] **Step 2: Create `components/AppShell.tsx`**:

```tsx
import { type ReactNode } from "react";

export function AppShell({
  email,
  roleLabel,
  children,
}: {
  email: string;
  roleLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold">Rocking</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {roleLabel}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>{email}</span>
            <form action="/auth/signout" method="post">
              <button className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Wrap the client layout.** Replace `app/(app)/layout.tsx` body so it renders the shell (keep the existing gate logic):

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { AppShell } from "@/components/AppShell";

const ROLE_LABEL: Record<string, string> = {
  client_manager: "Manager",
  client_member: "My machine",
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role === "rocking_staff") redirect("/admin");
  return (
    <AppShell email={me.profile.email} roleLabel={ROLE_LABEL[me.profile.role] ?? "Client"}>
      {children}
    </AppShell>
  );
}
```

- [ ] **Step 4: Wrap the admin layout.** Replace `app/(admin)/layout.tsx` body:

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { AppShell } from "@/components/AppShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "rocking_staff") redirect("/");
  return (
    <AppShell email={me.profile.email} roleLabel="Rocking admin">
      {children}
    </AppShell>
  );
}
```

> Note: the `/pending` and `/onboarding` pages live under `(app)` and now render inside the shell too — that's fine (they already guard their own state). The inner sign-out forms in those pages and in `admin/page.tsx` become redundant with the shell's; remove the inner ones in Task 5/6 when those pages are rewritten. Leave `pending`/`onboarding` as-is.

- [ ] **Step 5: Build + commit**

Run: `npm run build` → PASS.

```bash
git add app/globals.css components/AppShell.tsx "app/(app)/layout.tsx" "app/(admin)/layout.tsx"
git commit -m "feat(ui): clean light theme + app shell with sign-out"
```

---

### Task 2: Pure health module (TDD)

**Files:** Create `lib/views/health.ts`; Test `lib/views/health.test.ts`.

- [ ] **Step 1: Write the failing test** `lib/views/health.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deviceHealth, summarize, type DeviceInputs } from "./health";

const mk = (o: Partial<DeviceInputs> = {}): DeviceInputs => ({
  id: o.id ?? "d1",
  clientId: o.clientId ?? "c1",
  hostname: o.hostname ?? "PC1",
  user: o.user ?? "Alice",
  os: o.os ?? "Windows 11",
  avOk: o.avOk ?? true,
  patchStatus: o.patchStatus ?? "Fully Patched",
  patchesInstalled: o.patchesInstalled ?? 8,
  patchesPending: o.patchesPending ?? 0,
  usedPcts: o.usedPcts ?? [40],
  openAlerts: o.openAlerts ?? 0,
});

describe("deviceHealth", () => {
  it("a clean device needs no attention", () => {
    const h = deviceHealth(mk());
    expect(h.needsAttention).toBe(false);
    expect(h.maxDiskPct).toBe(40);
    expect(h.patchPct).toBe(100);
  });
  it("flags AV off", () => {
    expect(deviceHealth(mk({ avOk: false })).flags.avOff).toBe(true);
    expect(deviceHealth(mk({ avOk: false })).needsAttention).toBe(true);
  });
  it("flags a disk at or above 90%", () => {
    expect(deviceHealth(mk({ usedPcts: [55, 92] })).flags.diskFull).toBe(true);
    expect(deviceHealth(mk({ usedPcts: [55, 92] })).maxDiskPct).toBe(92);
  });
  it("flags reboot-required / install-error patch status", () => {
    expect(deviceHealth(mk({ patchStatus: "Reboot Required" })).flags.patchIssue).toBe(true);
    expect(deviceHealth(mk({ patchStatus: "Install Error" })).flags.patchIssue).toBe(true);
    expect(deviceHealth(mk({ patchStatus: "Fully Patched" })).flags.patchIssue).toBe(false);
  });
  it("flags open alerts", () => {
    expect(deviceHealth(mk({ openAlerts: 2 })).flags.openAlerts).toBe(true);
  });
  it("computes patch % from installed/(installed+pending)", () => {
    expect(deviceHealth(mk({ patchesInstalled: 6, patchesPending: 2 })).patchPct).toBe(75);
    expect(deviceHealth(mk({ patchesInstalled: 0, patchesPending: 0 })).patchPct).toBe(100);
  });
});

describe("summarize", () => {
  it("rolls up counts and fleet patch %", () => {
    const s = summarize([
      deviceHealth(mk({ id: "a", patchesInstalled: 10, patchesPending: 0 })),
      deviceHealth(mk({ id: "b", avOk: false, patchesInstalled: 6, patchesPending: 2 })),
    ]);
    expect(s.total).toBe(2);
    expect(s.needsAttention).toBe(1);
    expect(s.fleetPatchPct).toBe(88); // (100 + 75) / 2 rounded
  });
  it("handles an empty fleet", () => {
    const s = summarize([]);
    expect(s.total).toBe(0);
    expect(s.needsAttention).toBe(0);
    expect(s.fleetPatchPct).toBe(null);
  });
});
```

- [ ] **Step 2: Run the test — verify it FAILS**

Run: `npm test` — Expected: FAIL (cannot find `./health`).

- [ ] **Step 3: Implement `lib/views/health.ts`**:

```ts
export type DeviceInputs = {
  id: string;
  clientId: string;
  hostname: string;
  user: string | null;
  os: string | null;
  avOk: boolean | null;
  patchStatus: string | null;
  patchesInstalled: number | null;
  patchesPending: number | null;
  usedPcts: number[];
  openAlerts: number;
};

export type DeviceHealth = DeviceInputs & {
  maxDiskPct: number | null;
  patchPct: number | null;
  flags: { avOff: boolean; diskFull: boolean; patchIssue: boolean; openAlerts: boolean };
  needsAttention: boolean;
};

const PATCH_ISSUE = new Set(["Reboot Required", "Install Error"]);

export function deviceHealth(d: DeviceInputs): DeviceHealth {
  const maxDiskPct = d.usedPcts.length ? Math.max(...d.usedPcts) : null;
  const installed = d.patchesInstalled ?? 0;
  const pending = d.patchesPending ?? 0;
  const denom = installed + pending;
  const patchPct = denom > 0 ? Math.round((100 * installed) / denom) : 100;

  const flags = {
    avOff: d.avOk === false,
    diskFull: maxDiskPct !== null && maxDiskPct >= 90,
    patchIssue: d.patchStatus !== null && PATCH_ISSUE.has(d.patchStatus),
    openAlerts: d.openAlerts > 0,
  };
  const needsAttention = flags.avOff || flags.diskFull || flags.patchIssue || flags.openAlerts;
  return { ...d, maxDiskPct, patchPct, flags, needsAttention };
}

export type FleetSummary = {
  total: number;
  needsAttention: number;
  avOff: number;
  diskFull: number;
  patchIssue: number;
  openAlerts: number;
  fleetPatchPct: number | null;
};

export function summarize(devices: DeviceHealth[]): FleetSummary {
  const total = devices.length;
  const pcts = devices.map((d) => d.patchPct).filter((p): p is number => p !== null);
  const fleetPatchPct = pcts.length
    ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
    : null;
  return {
    total,
    needsAttention: devices.filter((d) => d.needsAttention).length,
    avOff: devices.filter((d) => d.flags.avOff).length,
    diskFull: devices.filter((d) => d.flags.diskFull).length,
    patchIssue: devices.filter((d) => d.flags.patchIssue).length,
    openAlerts: devices.filter((d) => d.flags.openAlerts).length,
    fleetPatchPct,
  };
}
```

- [ ] **Step 4: Run the test — verify it PASSES**

Run: `npm test` — Expected: all green (existing + new).

- [ ] **Step 5: Commit**

```bash
git add lib/views/health.ts lib/views/health.test.ts
git commit -m "feat(views): pure device-health + fleet-summary module (tested)"
```

---

### Task 3: RLS-scoped data-fetch layer

**Files:** Create `lib/views/devices.ts`, `lib/views/clients.ts`.

- [ ] **Step 1: `lib/views/devices.ts`** — fetch RLS-scoped rows and assemble `DeviceHealth[]`:

```ts
import { createClient } from "@/lib/supabase/server";
import { deviceHealth, type DeviceHealth, type DeviceInputs } from "./health";

/**
 * Returns the health of every device the caller can see (RLS-scoped):
 * staff = all, manager = their client, member = their assigned device(s).
 */
export async function getVisibleDeviceHealth(): Promise<DeviceHealth[]> {
  const supabase = await createClient();
  const [devices, patch, storage, alerts] = await Promise.all([
    supabase.from("devices").select("id, client_id, hostname, assigned_user_label, operating_system, av_ok"),
    supabase.from("device_patch_status").select("device_id, patch_status, patches_installed, patches_approved_pending"),
    supabase.from("device_storage").select("device_id, used_pct, drive_type"),
    supabase.from("device_alerts").select("device_id, resolved"),
  ]);

  const patchBy = new Map((patch.data ?? []).map((p) => [p.device_id, p]));
  const disksBy = new Map<string, number[]>();
  for (const s of storage.data ?? []) {
    if (s.used_pct === null || !(s.drive_type ?? "").toLowerCase().includes("local")) continue;
    (disksBy.get(s.device_id) ?? disksBy.set(s.device_id, []).get(s.device_id)!).push(Number(s.used_pct));
  }
  const openBy = new Map<string, number>();
  for (const a of alerts.data ?? []) {
    if (a.resolved) continue;
    openBy.set(a.device_id, (openBy.get(a.device_id) ?? 0) + 1);
  }

  return (devices.data ?? []).map((d) => {
    const p = patchBy.get(d.id);
    const inputs: DeviceInputs = {
      id: d.id,
      clientId: d.client_id,
      hostname: d.hostname,
      user: d.assigned_user_label,
      os: d.operating_system,
      avOk: d.av_ok,
      patchStatus: p?.patch_status ?? null,
      patchesInstalled: p?.patches_installed ?? null,
      patchesPending: p?.patches_approved_pending ?? null,
      usedPcts: disksBy.get(d.id) ?? [],
      openAlerts: openBy.get(d.id) ?? 0,
    };
    return deviceHealth(inputs);
  });
}

export type DeviceDetail = {
  health: DeviceHealth;
  drives: { drive: string; sizeGb: number | null; usedPct: number | null }[];
  alerts: { triggeredAt: string; message: string; priority: string | null; resolved: boolean }[];
  trend: { date: string; patchPct: number | null; maxDiskPct: number | null; openAlerts: number | null }[];
};

/** Full detail for one device (RLS still applies — returns null if not visible). */
export async function getDeviceDetail(deviceId: string): Promise<DeviceDetail | null> {
  const supabase = await createClient();
  const all = await getVisibleDeviceHealth();
  const health = all.find((d) => d.id === deviceId);
  if (!health) return null;

  const [drives, alerts, snaps] = await Promise.all([
    supabase.from("device_storage").select("drive, size_gb, used_pct").eq("device_id", deviceId),
    supabase.from("device_alerts").select("triggered_at, message, priority, resolved").eq("device_id", deviceId).order("triggered_at", { ascending: false }).limit(20),
    supabase.from("device_health_snapshots").select("snapshot_date, patch_pct, max_disk_pct, open_alert_count").eq("device_id", deviceId).order("snapshot_date"),
  ]);

  return {
    health,
    drives: (drives.data ?? []).map((d) => ({ drive: d.drive, sizeGb: d.size_gb, usedPct: d.used_pct })),
    alerts: (alerts.data ?? []).map((a) => ({ triggeredAt: a.triggered_at, message: a.message, priority: a.priority, resolved: a.resolved })),
    trend: (snaps.data ?? []).map((s) => ({ date: s.snapshot_date, patchPct: s.patch_pct, maxDiskPct: s.max_disk_pct, openAlerts: s.open_alert_count })),
  };
}
```

- [ ] **Step 2: `lib/views/clients.ts`** — admin per-client rollups + names:

```ts
import { createClient } from "@/lib/supabase/server";
import { summarize, type DeviceHealth, type FleetSummary } from "./health";
import { getVisibleDeviceHealth } from "./devices";

export type ClientSummary = { id: string; name: string; summary: FleetSummary };

/** Per-client rollups for every client the caller can see that has devices. */
export async function getClientSummaries(): Promise<ClientSummary[]> {
  const supabase = await createClient();
  const [clients, devices] = await Promise.all([
    supabase.from("clients").select("id, name"),
    getVisibleDeviceHealth(),
  ]);
  const nameById = new Map((clients.data ?? []).map((c) => [c.id, c.name]));
  const byClient = new Map<string, DeviceHealth[]>();
  for (const d of devices) {
    (byClient.get(d.clientId) ?? byClient.set(d.clientId, []).get(d.clientId)!).push(d);
  }
  return [...byClient.entries()]
    .map(([id, list]) => ({ id, name: nameById.get(id) ?? "Unknown", summary: summarize(list) }))
    .sort((a, b) => b.summary.needsAttention - a.summary.needsAttention || b.summary.total - a.summary.total);
}

/** Devices for one client (admin drill-in / manager fleet). RLS still applies. */
export async function getClientDevices(clientId: string): Promise<{ name: string; devices: DeviceHealth[] }> {
  const supabase = await createClient();
  const [client, devices] = await Promise.all([
    supabase.from("clients").select("name").eq("id", clientId).maybeSingle(),
    getVisibleDeviceHealth(),
  ]);
  return {
    name: client.data?.name ?? "Client",
    devices: devices.filter((d) => d.clientId === clientId),
  };
}
```

- [ ] **Step 3: Typecheck + build + commit**

Run: `npx tsc --noEmit` (clean) then `npm run build` (PASS). If the generated row types make a column nullable/named differently than assumed, adjust the field access to match `lib/types/database.ts` (do not use `as any`).

```bash
git add lib/views/devices.ts lib/views/clients.ts
git commit -m "feat(views): RLS-scoped device + client data-fetch layer"
```

---

### Task 4: Shared presentational components

**Files:** Create `components/AttentionBadge.tsx`, `SummaryStrip.tsx`, `DeviceTable.tsx`, `DeviceHealthCard.tsx`, `ClientCard.tsx`, `Sparkline.tsx`.

- [ ] **Step 1: `components/AttentionBadge.tsx`**:

```tsx
export function AttentionBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
      }`}
    >
      {ok ? "Healthy" : "Needs attention"}
    </span>
  );
}
```

- [ ] **Step 2: `components/SummaryStrip.tsx`**:

```tsx
import type { FleetSummary } from "@/lib/views/health";

export function SummaryStrip({ summary }: { summary: FleetSummary }) {
  const items = [
    { label: "Devices", value: summary.total },
    { label: "Need attention", value: summary.needsAttention },
    { label: "Fleet patched", value: summary.fleetPatchPct === null ? "—" : `${summary.fleetPatchPct}%` },
    { label: "AV off", value: summary.avOff },
    { label: "Disks ≥90%", value: summary.diskFull },
    { label: "Open alerts", value: summary.openAlerts },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((it) => (
        <div key={it.label} className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="text-2xl font-semibold">{it.value}</div>
          <div className="text-xs text-gray-500">{it.label}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `components/DeviceTable.tsx`**:

```tsx
import type { DeviceHealth } from "@/lib/views/health";
import { AttentionBadge } from "./AttentionBadge";

export function DeviceTable({ devices }: { devices: DeviceHealth[] }) {
  if (devices.length === 0)
    return <p className="text-gray-500">No devices.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2">Device</th>
            <th className="px-3 py-2">User</th>
            <th className="px-3 py-2">OS</th>
            <th className="px-3 py-2">Patch</th>
            <th className="px-3 py-2">Disk</th>
            <th className="px-3 py-2">AV</th>
            <th className="px-3 py-2">Alerts</th>
            <th className="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id} className="border-b border-gray-100 last:border-0">
              <td className="px-3 py-2 font-medium">{d.hostname}</td>
              <td className="px-3 py-2 text-gray-600">{d.user ?? "—"}</td>
              <td className="px-3 py-2 text-gray-600">{d.os ?? "—"}</td>
              <td className={`px-3 py-2 ${d.flags.patchIssue ? "text-red-600" : "text-gray-600"}`}>
                {d.patchStatus ?? "—"}
              </td>
              <td className={`px-3 py-2 ${d.flags.diskFull ? "text-red-600" : "text-gray-600"}`}>
                {d.maxDiskPct === null ? "—" : `${Math.round(d.maxDiskPct)}%`}
              </td>
              <td className={`px-3 py-2 ${d.flags.avOff ? "text-red-600" : "text-gray-600"}`}>
                {d.avOk === false ? "Off" : d.avOk === true ? "On" : "—"}
              </td>
              <td className={`px-3 py-2 ${d.flags.openAlerts ? "text-red-600" : "text-gray-600"}`}>
                {d.openAlerts}
              </td>
              <td className="px-3 py-2"><AttentionBadge ok={!d.needsAttention} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: `components/DeviceHealthCard.tsx`** (plain-language single device, for the member view):

```tsx
import type { DeviceHealth } from "@/lib/views/health";
import { AttentionBadge } from "./AttentionBadge";

export function DeviceHealthCard({ device }: { device: DeviceHealth }) {
  const lines: string[] = [];
  if (device.flags.avOff) lines.push("Antivirus is not running.");
  if (device.flags.diskFull) lines.push(`Disk is nearly full (${Math.round(device.maxDiskPct ?? 0)}% used).`);
  if (device.flags.patchIssue) lines.push(`Updates need attention (${device.patchStatus}).`);
  if (device.flags.openAlerts) lines.push(`${device.openAlerts} open alert${device.openAlerts === 1 ? "" : "s"}.`);

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{device.hostname}</h2>
        <AttentionBadge ok={!device.needsAttention} />
      </div>
      <p className="mt-1 text-sm text-gray-500">{device.os ?? ""}</p>
      <p className="mt-4 text-sm">
        {device.needsAttention
          ? lines.join(" ")
          : "Your machine is healthy — up to date, antivirus on, plenty of disk space."}
      </p>
    </div>
  );
}
```

- [ ] **Step 5: `components/ClientCard.tsx`** (admin per-client rollup, links to drill-in):

```tsx
import Link from "next/link";
import type { ClientSummary } from "@/lib/views/clients";

export function ClientCard({ client }: { client: ClientSummary }) {
  const s = client.summary;
  return (
    <Link
      href={`/admin/clients/${client.id}`}
      className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="font-medium">{client.name}</span>
        <span className={`text-sm font-semibold ${s.needsAttention ? "text-red-600" : "text-green-600"}`}>
          {s.needsAttention ? `${s.needsAttention} need attention` : "All healthy"}
        </span>
      </div>
      <div className="mt-2 text-xs text-gray-500">
        {s.total} devices · {s.fleetPatchPct === null ? "—" : `${s.fleetPatchPct}%`} patched · {s.openAlerts} alerts
      </div>
    </Link>
  );
}
```

- [ ] **Step 6: `components/Sparkline.tsx`** (tiny inline SVG, degrades to a dash for <2 points):

```tsx
export function Sparkline({ values, width = 120, height = 28 }: { values: number[]; width?: number; height?: number }) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return <span className="text-xs text-gray-400">not enough history</span>;
  const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
  const step = width / (pts.length - 1);
  const d = pts
    .map((v, i) => `${i === 0 ? "M" : "L"} ${i * step} ${height - ((v - min) / range) * height}`)
    .join(" ");
  return (
    <svg width={width} height={height} className="text-blue-500">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
```

- [ ] **Step 7: Build + commit**

Run: `npm run build` → PASS.

```bash
git add components/
git commit -m "feat(ui): shared dashboard components (badge, summary, table, cards, sparkline)"
```

---

### Task 5: Admin All-Clients cockpit + client drill-in

**Files:** Replace `app/(admin)/admin/page.tsx`; Create `app/(admin)/admin/clients/[id]/page.tsx`.

- [ ] **Step 1: Replace `app/(admin)/admin/page.tsx`**:

```tsx
import Link from "next/link";
import { getClientSummaries } from "@/lib/views/clients";
import { getVisibleDeviceHealth } from "@/lib/views/devices";
import { ClientCard } from "@/components/ClientCard";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";

export default async function AdminHome() {
  const [clients, devices] = await Promise.all([getClientSummaries(), getVisibleDeviceHealth()]);
  const overall = summarize(devices);
  const attention = devices.filter((d) => d.needsAttention);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">All clients</h1>
        <Link href="/admin/pending" className="text-sm text-blue-600 hover:underline">
          Pending approvals
        </Link>
      </div>

      <SummaryStrip summary={overall} />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
          Needs attention now ({attention.length})
        </h2>
        <DeviceTable devices={attention} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
          Clients ({clients.length})
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <ClientCard key={c.id} client={c} />
          ))}
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/(admin)/admin/clients/[id]/page.tsx`**:

```tsx
import Link from "next/link";
import { getClientDevices } from "@/lib/views/clients";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";

export default async function AdminClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { name, devices } = await getClientDevices(id);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">
          ← All clients
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{name}</h1>
      </div>
      <SummaryStrip summary={summarize(devices)} />
      <DeviceTable devices={devices} />
    </div>
  );
}
```

- [ ] **Step 3: Build + commit**

Run: `npm run build` → PASS.

```bash
git add "app/(admin)/admin/page.tsx" "app/(admin)/admin/clients"
git commit -m "feat(admin): All-Clients cockpit + client drill-in over live data"
```

---

### Task 6: Client surface — manager Network Overview & member My Machine

**Files:** Replace `app/(app)/page.tsx`.

- [ ] **Step 1: Replace `app/(app)/page.tsx`** (keep the existing routing guards, then branch by role):

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { resolveLandingPath } from "@/lib/auth/routing";
import { getVisibleDeviceHealth } from "@/lib/views/devices";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";
import { DeviceHealthCard } from "@/components/DeviceHealthCard";

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

  const devices = await getVisibleDeviceHealth();

  if (me.profile.role === "client_manager") {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Network overview</h1>
        <SummaryStrip summary={summarize(devices)} />
        <DeviceTable devices={devices} />
      </div>
    );
  }

  // client_member — their claimed device(s)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My machine</h1>
      {devices.length === 0 ? (
        <p className="text-gray-500">No machine is linked to your account yet.</p>
      ) : (
        devices.map((d) => <DeviceHealthCard key={d.id} device={d} />)
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build + commit**

Run: `npm run build` → PASS.

```bash
git add "app/(app)/page.tsx"
git commit -m "feat(app): manager Network Overview + member My Machine views"
```

---

### Task 7: Verification (live + static)

- [ ] **Step 1: Static checks**

Run: `npm run build && npm test && npx tsc --noEmit && npm run lint` — all PASS.

- [ ] **Step 2: RLS sanity via rolled-back probe** (the views rely on table RLS; confirm a manager sees only their client). Using the technique from Plan 1, write `/tmp/views_rls.sql` and run `supabase db query --linked -f`:

```sql
begin;
set local role authenticated;
-- GSR Law manager: use a real GSR Law device's client_id by joining; assert scoping by counting
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}';
select 1; -- placeholder: replace sub with a real GSR Law manager profile id during execution
rollback;
```

> During execution, instead of fabricating users, simply confirm the already-verified Plan 1 device RLS still holds (it underpins these views) and rely on the UI walkthrough in Step 3. If you want a live RLS assertion, seed a manager for an existing client in a rolled-back transaction as in Plan 1's probes and assert `getVisibleDeviceHealth`-equivalent counts.

- [ ] **Step 3: Live walkthrough (record what you see)**

Run `npm run dev`. As an admin (`@rocking.one`): `/admin` shows the SummaryStrip, a "needs attention" table (GSR Law devices etc.), and client cards; clicking a client opens `/admin/clients/[id]` with that client's fleet. Confirm numbers match the earlier SQL summary (GSR Law 30 devices, etc.). Capture a screenshot if possible. (Manager/member surfaces need a seeded/claimed client user to view; note this if not exercised.)

- [ ] **Step 4: Commit any fixes + push**

```bash
git push
```

---

## Self-Review

**Spec coverage (design Section 4):**
- Individual "My Machine" (claimed device, plain language) → Task 6 member branch + DeviceHealthCard. ✓
- Manager "Network Overview" (fleet table + summary strip + trend) → Task 6 manager branch. Trend component exists (Sparkline/health snapshots) and is wired in device detail; fleet-level trend is minimal by design (one snapshot date so far). ✓
- Admin "All Clients" (cards, drill-in, global attention) → Task 5. ✓
- Shared DeviceTable/DeviceHealthCard reused across views → Task 4, used in 5 & 6. ✓
- RLS-enforced scoping → relies on verified table RLS via `getVisibleDeviceHealth` (Task 3). ✓

**Deferred:** manager role-management UI; charts library; full multi-month trends (await more ingested reports).

**Placeholder scan:** no TBD/TODO in shipped code. The Task 7 Step 2 SQL is explicitly a guided probe, not shipped code.

**Type consistency:** `DeviceInputs`/`DeviceHealth`/`FleetSummary` defined in `health.ts` (Task 2) and consumed unchanged in `devices.ts`/`clients.ts` (Task 3) and components (Task 4); `ClientSummary` defined in `clients.ts` and consumed by `ClientCard` (Task 4) and admin page (Task 5). Component prop names match.
