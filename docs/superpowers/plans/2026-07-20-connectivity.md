# Connectivity Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connectivity customers see their internet lines with live LibreNMS status and a one-click problem report; staff manage the line inventory on the client page.

**Architecture:** New `connectivity_services` table (portal = source of record, staff-maintained). A server-only LibreNMS proxy fetches live status at page view with hard timeouts and null-degradation. Client `/connectivity` page + admin `ConnectivitySection`, wired into nav (conditional like billing), feature access, and activity tracking.

**Tech Stack:** Next.js 16, Supabase RLS, LibreNMS REST API v0, vitest.

**Spec:** `docs/superpowers/specs/2026-07-20-connectivity-design.md`

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs`; verify `supabase/.temp/project-ref` AND check `ls supabase/migrations | tail` for parallel-session number collisions immediately before push. Next expected: `0049`.
- Kinds exactly `fibre|wireless|lte|other`. Client read = own + `is_active` only. Staff-only writes.
- LibreNMS env: `LIBRENMS_URL`, `LIBRENMS_API_KEY` — currently ABSENT; every code path must render fine without them (`up: null` everywhere).
- Proxy timeout ~3s per request; proxy never throws.
- Feature key `connectivity` (manager default on, member off); nav at TOP of "Your services", rendered only when the client has ≥1 active service; `/connectivity` visits tracked in the activity feed.
- Pure helpers import-free (vitest-safe). Quote parenthesized paths. Stale `.git/index.lock` → remove, retry.

---

### Task 1: Pure helpers + tests (TDD)

**Files:** Create `lib/connectivity-helpers.ts`; test `lib/connectivity-helpers.test.ts`.

**Interfaces (produced):**
- `KIND_LABELS: Record<string, string>` (`fibre` → "Fibre", `wireless` → "Fixed wireless", `lte` → "LTE", `other` → "Link")
- `speedLabel(down: number | null, up: number | null): string | null` — "100/50 Mbps", "100 Mbps" (down only), null when neither.
- `type LineStatus = { up: boolean | null; downSince: string | null }`
- `mapLibrenmsDevice(d: unknown): LineStatus` — LibreNMS device payload → status; `status` 1/true → up, 0/false → down; `last_polled`+`status_reason`/downtime not guaranteed → downSince from `d.downtime`-style fields when numeric seconds present, else null; malformed → `{up: null, downSince: null}`.

- [ ] **Step 1: failing test** — `lib/connectivity-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapLibrenmsDevice, speedLabel, KIND_LABELS } from "./connectivity-helpers";

describe("speedLabel", () => {
  it("formats down/up", () => {
    expect(speedLabel(100, 50)).toBe("100/50 Mbps");
  });
  it("formats download-only", () => {
    expect(speedLabel(100, null)).toBe("100 Mbps");
  });
  it("null when unknown", () => {
    expect(speedLabel(null, null)).toBeNull();
  });
});

describe("mapLibrenmsDevice", () => {
  const NOW = 1_760_000_000_000; // fixed ms epoch for downSince math
  it("maps an up device", () => {
    expect(mapLibrenmsDevice({ status: 1 }, NOW)).toEqual({ up: true, downSince: null });
  });
  it("maps a down device with downtime seconds", () => {
    const r = mapLibrenmsDevice({ status: 0, downtime: 3600 }, NOW);
    expect(r.up).toBe(false);
    expect(r.downSince).toBe(new Date(NOW - 3600 * 1000).toISOString());
  });
  it("down without downtime info", () => {
    expect(mapLibrenmsDevice({ status: 0 }, NOW)).toEqual({ up: false, downSince: null });
  });
  it("malformed payload degrades to unknown", () => {
    expect(mapLibrenmsDevice(null, NOW)).toEqual({ up: null, downSince: null });
    expect(mapLibrenmsDevice({ nope: true }, NOW)).toEqual({ up: null, downSince: null });
  });
});

describe("KIND_LABELS", () => {
  it("labels every kind", () => {
    for (const k of ["fibre", "wireless", "lte", "other"]) expect(KIND_LABELS[k]).toBeTruthy();
  });
});
```

- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3: implement** — `lib/connectivity-helpers.ts`:

```ts
/** Pure connectivity logic — no server imports (vitest-safe). */

export const KIND_LABELS: Record<string, string> = {
  fibre: "Fibre",
  wireless: "Fixed wireless",
  lte: "LTE",
  other: "Link",
};

/** "100/50 Mbps" | "100 Mbps" | null. */
export function speedLabel(down: number | null, up: number | null): string | null {
  if (down == null && up == null) return null;
  if (down != null && up != null) return `${down}/${up} Mbps`;
  return `${down ?? up} Mbps`;
}

export type LineStatus = { up: boolean | null; downSince: string | null };

/** LibreNMS /devices/:id payload → LineStatus. status 1/true=up, 0/false=down;
 *  downtime (seconds) → downSince. Anything malformed → unknown, never throws. */
export function mapLibrenmsDevice(d: unknown, nowMs: number): LineStatus {
  if (!d || typeof d !== "object") return { up: null, downSince: null };
  const rec = d as Record<string, unknown>;
  const s = rec.status;
  if (s === 1 || s === true || s === "1") return { up: true, downSince: null };
  if (s === 0 || s === false || s === "0") {
    const dt = typeof rec.downtime === "number" ? rec.downtime : Number(rec.downtime);
    return {
      up: false,
      downSince: Number.isFinite(dt) && dt > 0 ? new Date(nowMs - dt * 1000).toISOString() : null,
    };
  }
  return { up: null, downSince: null };
}
```

- [ ] **Step 4:** helper + full suite green.
- [ ] **Step 5:** commit `feat(connectivity): pure kind/speed/status helpers`.

---

### Task 2: Migration 0049 — connectivity_services

**Files:** Create `supabase/migrations/0049_connectivity_services.sql`; regen types.

- [ ] **Step 1:** check `ls supabase/migrations | tail -2` — if 0049 is taken by a parallel session, renumber up. Migration:

```sql
-- Connectivity services: the internet lines Rocking provides per client.
-- The PORTAL is the source of record (no upstream system) — staff enter and
-- maintain these. librenms_device_id links a line to live monitoring.
create table public.connectivity_services (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  label              text not null,
  kind               text not null default 'fibre' check (kind in ('fibre','wireless','lte','other')),
  provider           text,
  download_mbps      int,
  upload_mbps        int,
  librenms_device_id int,
  notes              text,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index connectivity_services_client_idx on public.connectivity_services (client_id);

alter table public.connectivity_services enable row level security;
create policy connectivity_services_staff on public.connectivity_services
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
-- Clients read their own ACTIVE lines (members included — page access is
-- feature-gated separately; retired lines are staff-only history).
create policy connectivity_services_client_read on public.connectivity_services
  for select using (client_id = public.current_client_id() and is_active);
```

- [ ] **Step 2:** verify ref; `npx supabase db push --linked`; regen types; `npx tsc --noEmit` (clear `.next` " 2" dupes if the known Finder-junk errors appear).
- [ ] **Step 3:** commit `feat(connectivity): connectivity_services table + RLS`.

---

### Task 3: LibreNMS proxy + views + staff actions

**Files:** Create `lib/librenms.ts`, `lib/views/connectivity.ts`, `lib/actions/connectivity.ts`.

**Interfaces (produced):**
- `getLineStatuses(deviceIds: number[]): Promise<Map<number, LineStatus>>`
- `type ConnectivityLine = { id: string; label: string; kind: string; provider: string | null; speed: string | null; librenmsDeviceId: number | null; notes: string | null; isActive: boolean; status: LineStatus | null }`
- `getConnectivityLines(clientId: string, opts?: { includeInactive?: boolean }): Promise<ConnectivityLine[]>` — status populated live for mapped lines.
- `hasConnectivity(clientId: string): Promise<boolean>` (for nav).
- Actions (staff-guarded): `addLine(clientId, formData)`, `updateLine(lineId, clientId, formData)`, `setLineActive(lineId, clientId, active)`, `deleteLine(lineId, clientId)`.

- [ ] **Step 1:** `lib/librenms.ts`:

```ts
import "server-only";
import { mapLibrenmsDevice, type LineStatus } from "@/lib/connectivity-helpers";

const TIMEOUT_MS = 3000;

/** Live line status from LibreNMS. Missing env or any failure → up:null for
 *  that device. Never throws — a monitoring hiccup must not break the page. */
export async function getLineStatuses(deviceIds: number[]): Promise<Map<number, LineStatus>> {
  const out = new Map<number, LineStatus>();
  const url = process.env.LIBRENMS_URL;
  const key = process.env.LIBRENMS_API_KEY;
  const unknown: LineStatus = { up: null, downSince: null };
  if (!url || !key || deviceIds.length === 0) {
    for (const id of deviceIds) out.set(id, unknown);
    return out;
  }
  await Promise.all(
    deviceIds.map(async (id) => {
      try {
        const res = await fetch(`${url.replace(/\/$/, "")}/api/v0/devices/${id}`, {
          headers: { "X-Auth-Token": key },
          cache: "no-store",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        // API returns { devices: [ {...} ] }
        out.set(id, mapLibrenmsDevice(body?.devices?.[0] ?? null, Date.now()));
      } catch {
        out.set(id, unknown);
      }
    }),
  );
  return out;
}
```

- [ ] **Step 2:** `lib/views/connectivity.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { getLineStatuses } from "@/lib/librenms";
import { speedLabel, type LineStatus } from "@/lib/connectivity-helpers";

export type ConnectivityLine = {
  id: string;
  label: string;
  kind: string;
  provider: string | null;
  speed: string | null;
  librenmsDeviceId: number | null;
  notes: string | null;
  isActive: boolean;
  status: LineStatus | null;
};

/** A client's lines with live status for mapped ones. RLS scopes rows:
 *  clients see only their own active lines; staff may includeInactive. */
export async function getConnectivityLines(
  clientId: string,
  opts?: { includeInactive?: boolean },
): Promise<ConnectivityLine[]> {
  const supabase = await createClient();
  let q = supabase
    .from("connectivity_services")
    .select("id, label, kind, provider, download_mbps, upload_mbps, librenms_device_id, notes, is_active")
    .eq("client_id", clientId)
    .order("label");
  if (!opts?.includeInactive) q = q.eq("is_active", true);
  const { data } = await q;
  const rows = data ?? [];
  const ids = rows.map((r) => r.librenms_device_id).filter((n): n is number => n != null);
  const statuses = await getLineStatuses([...new Set(ids)]);
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    provider: r.provider,
    speed: speedLabel(r.download_mbps, r.upload_mbps),
    librenmsDeviceId: r.librenms_device_id,
    notes: r.notes,
    isActive: r.is_active,
    status: r.librenms_device_id != null ? (statuses.get(r.librenms_device_id) ?? null) : null,
  }));
}

/** Cheap existence check for nav gating. */
export async function hasConnectivity(clientId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("connectivity_services")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("is_active", true);
  return (count ?? 0) > 0;
}
```

- [ ] **Step 3:** `lib/actions/connectivity.ts` (staff()-guard pattern as in `lib/actions/support-packages.ts`; `str()` helper same):

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";

const KINDS = ["fibre", "wireless", "lte", "other"];

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};
const num = (fd: FormData, k: string) => {
  const v = Number(fd.get(k));
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
};

function revalidate(clientId: string) {
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/connectivity");
}

function lineFields(fd: FormData) {
  const kind = String(fd.get("kind") ?? "fibre");
  return {
    label: str(fd, "label"),
    kind: KINDS.includes(kind) ? kind : "other",
    provider: str(fd, "provider"),
    download_mbps: num(fd, "download_mbps"),
    upload_mbps: num(fd, "upload_mbps"),
    librenms_device_id: num(fd, "librenms_device_id"),
    notes: str(fd, "notes"),
  };
}

export async function addLine(clientId: string, formData: FormData) {
  await staff();
  const fields = lineFields(formData);
  if (!fields.label) throw new Error("a line needs a label");
  const supabase = await createClient();
  const { error } = await supabase.from("connectivity_services").insert({ client_id: clientId, ...fields });
  if (error) throw new Error(error.message);
  revalidate(clientId);
}

export async function updateLine(lineId: string, clientId: string, formData: FormData) {
  await staff();
  const fields = lineFields(formData);
  if (!fields.label) throw new Error("a line needs a label");
  const supabase = await createClient();
  const { error } = await supabase
    .from("connectivity_services")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", lineId);
  if (error) throw new Error(error.message);
  revalidate(clientId);
}

export async function setLineActive(lineId: string, clientId: string, active: boolean) {
  await staff();
  const supabase = await createClient();
  await supabase
    .from("connectivity_services")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", lineId);
  revalidate(clientId);
}

export async function deleteLine(lineId: string, clientId: string) {
  await staff();
  const supabase = await createClient();
  await supabase.from("connectivity_services").delete().eq("id", lineId);
  revalidate(clientId);
}
```

- [ ] **Step 4:** `npx tsc --noEmit` clean; commit `feat(connectivity): librenms proxy, views, staff actions`.

---

### Task 4: Client page, nav, feature access, activity, ticket prefill

**Files:** Create `app/(app)/connectivity/page.tsx`; modify `lib/nav.ts`, `app/(app)/layout.tsx`, `components/AppShell.tsx` (nothing — gating rides on allowedHrefs + a `connectivityEnabled` filter like billing), `lib/feature-access.ts` (+test), `lib/activity-helpers.ts` (+test), `app/(app)/support/new/page.tsx` (subject prefill).

- [ ] **Step 1: client page** — `app/(app)/connectivity/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getConnectivityLines } from "@/lib/views/connectivity";
import { KIND_LABELS } from "@/lib/connectivity-helpers";
import { Card, PageHeader, StatusPill } from "@/components/ui";

const fmtSince = (iso: string) => iso.replace("T", " ").slice(0, 16);

export default async function ConnectivityPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "connectivity")) redirect("/");
  if (!me.profile.client_id) redirect("/");

  const lines = await getConnectivityLines(me.profile.client_id);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Connectivity"
        subtitle="Your internet lines — what you have and whether it's up right now."
      />
      {lines.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">No connectivity services on your account yet.</p>
        </Card>
      ) : (
        lines.map((l) => (
          <Card key={l.id}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-semibold text-ink">{l.label}</span>
                  {l.status &&
                    (l.status.up === true ? (
                      <StatusPill tone="good" label="Online" />
                    ) : l.status.up === false ? (
                      <StatusPill tone="bad" label={l.status.downSince ? `Down since ${fmtSince(l.status.downSince)}` : "Down"} />
                    ) : (
                      <StatusPill tone="warn" label="Status unavailable" />
                    ))}
                </div>
                <p className="mt-0.5 text-[13px] text-muted">
                  {[KIND_LABELS[l.kind] ?? l.kind, l.speed, l.provider].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Link
                href={`/support/new?subject=${encodeURIComponent(`Line problem: ${l.label}`)}`}
                className="ml-auto shrink-0 rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-line-soft"
              >
                Report a problem
              </Link>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: nav + layout.** `lib/nav.ts`: add `{ label: "Connectivity", href: "/connectivity" }` as the FIRST item of client_manager's "Your services" group. `app/(app)/layout.tsx`: fetch `hasConnectivity(me.profile.client_id)` alongside the client query; pass the result through the same mechanism as billing: extend `AppShell` usage by filtering — concretely, compute `allowedHrefs` as today and additionally REMOVE `"/connectivity"` from it when `!connectivityEnabled` (mirror of the billing rule, done in the layout so AppShell needs no change beyond what exists — billing keeps its in-AppShell rule).
- [ ] **Step 3: feature access.** `lib/feature-access.ts`: add `"connectivity"` to `FEATURES` (first), `FEATURE_LABELS` ("Connectivity"), `FEATURE_HREFS` ("/connectivity"). Test additions in `lib/feature-access.test.ts`:

```ts
  it("connectivity is a gateable manager default", () => {
    expect(canAccess("client_manager", null, "connectivity")).toBe(true);
    expect(canAccess("client_manager", { connectivity: false }, "connectivity")).toBe(false);
    expect(canAccess("client_member", null, "connectivity")).toBe(false);
  });
```

- [ ] **Step 4: activity.** `lib/activity-helpers.ts`: add `connectivity: "Connectivity"` to `SECTION_LABELS` and `"connectivity"` to the `SECTIONS` set. Test addition:

```ts
  it("maps connectivity", () => {
    expect(sectionFromPath("/connectivity")).toBe("connectivity");
  });
```

- [ ] **Step 5: ticket prefill.** `app/(app)/support/new/page.tsx` (client component): `import { useSearchParams } from "next/navigation";` then in the component `const subjectDefault = useSearchParams().get("subject") ?? "";` and `defaultValue={subjectDefault}` on the subject input. (Wrap page in `<Suspense>` if the build demands it for useSearchParams.)
- [ ] **Step 6:** `npm test && npm run build` green; commit `feat(connectivity): client page, nav gating, feature + activity wiring`.

---

### Task 5: Admin ConnectivitySection

**Files:** Create `app/(admin)/admin/clients/[id]/ConnectivitySection.tsx`; modify `app/(admin)/admin/clients/[id]/page.tsx` (render below SupportSection).

- [ ] **Step 1:** `ConnectivitySection.tsx` (server component; FIELD style + patterns as `SupportSection.tsx`):

```tsx
import { getConnectivityLines } from "@/lib/views/connectivity";
import { addLine, updateLine, setLineActive, deleteLine } from "@/lib/actions/connectivity";
import { KIND_LABELS } from "@/lib/connectivity-helpers";
import { Card, CardHeader, StatusPill } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";
const KINDS = ["fibre", "wireless", "lte", "other"] as const;

/** Staff-only: the client's connectivity lines — the portal is the source of
 *  record. Live status shown so staff see what the client sees. */
export async function ConnectivitySection({ clientId }: { clientId: string }) {
  const lines = await getConnectivityLines(clientId, { includeInactive: true });
  const add = addLine.bind(null, clientId);

  return (
    <Card>
      <CardHeader title="Connectivity" count={lines.filter((l) => l.isActive).length} />

      <form action={add} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5">
        <input name="label" required placeholder="Label, e.g. Main office fibre" className={`${FIELD} w-52`} />
        <select name="kind" defaultValue="fibre" className={FIELD}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <input name="provider" placeholder="Provider" className={`${FIELD} w-32`} />
        <input name="download_mbps" type="number" min="1" placeholder="Down" className={`${FIELD} w-20`} />
        <input name="upload_mbps" type="number" min="1" placeholder="Up" className={`${FIELD} w-20`} />
        <input name="librenms_device_id" type="number" min="1" placeholder="NMS id" className={`${FIELD} w-24`} />
        <input name="notes" placeholder="Notes" className={`${FIELD} min-w-0 flex-1`} />
        <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
          Add line
        </button>
      </form>

      {lines.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No lines recorded for this client.</p>
      ) : (
        <ul>
          {lines.map((l) => {
            const toggle = setLineActive.bind(null, l.id, clientId, !l.isActive);
            const remove = deleteLine.bind(null, l.id, clientId);
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2.5 border-b border-line-soft px-4 py-3 last:border-0">
                <span className={`font-medium ${l.isActive ? "text-ink" : "text-faint line-through"}`}>{l.label}</span>
                {l.status &&
                  (l.status.up === true ? (
                    <StatusPill tone="good" label="Online" />
                  ) : l.status.up === false ? (
                    <StatusPill tone="bad" label="Down" />
                  ) : (
                    <StatusPill tone="warn" label="?" />
                  ))}
                <span className="text-[13px] text-muted">
                  {[KIND_LABELS[l.kind] ?? l.kind, l.speed, l.provider, l.librenmsDeviceId ? `NMS ${l.librenmsDeviceId}` : "unmapped"]
                    .filter(Boolean)
                    .join(" · ")}
                  {l.notes ? ` · ${l.notes}` : ""}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-3">
                  <form action={toggle}>
                    <button className="text-xs text-faint hover:text-ink" title={l.isActive ? "Retire line" : "Reactivate line"}>
                      {l.isActive ? "Retire" : "Reactivate"}
                    </button>
                  </form>
                  {!l.isActive && (
                    <form action={remove}>
                      <button className="text-xs text-faint hover:text-brand" title="Delete permanently">
                        Delete
                      </button>
                    </form>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
```

Note: `setLineActive`/`deleteLine` take plain args — `.bind` with multiple args works for server actions; edit-in-place of every field is deliberately NOT in v1 (retire + re-add covers it; `updateLine` exists for a follow-up edit UI if wanted — keep the action, it's 15 lines).
- [ ] **Step 2:** render `<ConnectivitySection clientId={id} />` after `<SupportSection …/>` in the admin client page.
- [ ] **Step 3:** `npm run build` green; commit `feat(connectivity): admin line management on client page`.

---

### Task 6: Verify + push

- [ ] **Step 1:** `npm test && npm run build` — green.
- [ ] **Step 2:** programmatic: seed a line for a real connectivity client via the service key; verify client-read RLS (anon = 0 rows; the client's manager JWT path is covered by the feature-access pattern already proven); verify `/connectivity` in build output; verify nav shows only with active service (check layout logic by reading, plus prod spot-check after deploy).
- [ ] **Step 3:** push; deploy health-check `/connectivity` (307 to login, no 500); confirm LibreNMS-less rendering (no env vars yet → pills say nothing/unavailable as designed).
- [ ] **Step 4:** remind Shawn: add `LIBRENMS_URL` + read-only `LIBRENMS_API_KEY` to `.env.local` AND Vercel env for live pills; map device ids per line in the admin card.
