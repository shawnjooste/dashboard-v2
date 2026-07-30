# Connectivity Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each connectivity line shows its description, connection settings (PPPoE encrypted / static IP), and live ICMP health with a 24h latency trend, fed by a 5-minute pull running on Vision.

**Architecture:** New columns + a `connectivity_samples` table hold what the pull writes; `scripts/connectivity-pull.mjs` runs on the LibreNMS box and posts status to Supabase; the page reads stored status (slice 1's live proxy is retired). PPPoE passwords are AES-256-GCM encrypted with a TS mirror of the existing `.mjs` crypto helpers, revealed on demand by a guarded server action.

**Tech Stack:** Next.js 16, Supabase RLS, node:crypto (AES-256-GCM), LibreNMS API v0, vitest.

**Spec:** `docs/superpowers/specs/2026-07-24-connectivity-slice2-design.md`

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs`. **Check `ls supabase/migrations | tail -2` immediately before writing the migration** — the parallel support session reached 0069; expected next is 0070.
- `conn_type` exactly `pppoe|static|dhcp`. Stale threshold **20 minutes**. Samples retained **48h**.
- `pppoe_secret` is `{ciphertext, iv, tag}` jsonb — NEVER selected by client-facing list queries; only the reveal action reads it.
- Reveal allowed for: staff, or a manager of that client **with the `connectivity` feature** (`canAccess`).
- Enc key env: `CONNECTIVITY_ENC_KEY` (base64 32 bytes). Absent → save/reveal return errors, page still renders.
- Pull must never throw per-device: a failed device bumps `last_checked_at` only, leaving prior status intact.
- Pure helpers import-free (vitest-safe). Quote parenthesized paths. `.next` " N" duplicate files break tsc — `find .next -name "* [0-9].*" -delete` if that error appears.

---

### Task 1: Pure helpers + tests (TDD)

**Files:** Modify `lib/connectivity-helpers.ts`, `lib/connectivity-helpers.test.ts`.

**Interfaces (produced):**
- `type IcmpSample = { up: boolean | null; latencyMs: number | null; lossPct: number | null }`
- `mapIcmp(device: unknown): IcmpSample` — LibreNMS device payload → sample.
- `nextDownSince(prevDownSince: string | null, up: boolean | null, nowIso: string): string | null`
- `isStale(lastCheckedAt: string | null, nowMs: number): boolean` — true when null or older than 20 min.
- `CONN_TYPES: readonly ["pppoe","static","dhcp"]`, `CONN_TYPE_LABELS: Record<string,string>`

- [ ] **Step 1: append failing tests** to `lib/connectivity-helpers.test.ts`:

```ts
import { mapIcmp, nextDownSince, isStale, CONN_TYPE_LABELS } from "./connectivity-helpers";

describe("mapIcmp", () => {
  it("reads status + ping stats", () => {
    expect(mapIcmp({ status: 1, ping_avg: 12.4, ping_loss: 0 })).toEqual({ up: true, latencyMs: 12.4, lossPct: 0 });
  });
  it("reads a down device", () => {
    expect(mapIcmp({ status: 0, ping_avg: null, ping_loss: 100 })).toEqual({ up: false, latencyMs: null, lossPct: 100 });
  });
  it("tolerates string numbers", () => {
    expect(mapIcmp({ status: "1", ping_avg: "8.2", ping_loss: "0" })).toEqual({ up: true, latencyMs: 8.2, lossPct: 0 });
  });
  it("unknown when malformed", () => {
    expect(mapIcmp(null)).toEqual({ up: null, latencyMs: null, lossPct: null });
    expect(mapIcmp({ nope: 1 })).toEqual({ up: null, latencyMs: null, lossPct: null });
  });
});

describe("nextDownSince", () => {
  const NOW = "2026-07-24T10:00:00.000Z";
  it("stamps the start of an outage", () => {
    expect(nextDownSince(null, false, NOW)).toBe(NOW);
  });
  it("preserves the original outage start", () => {
    expect(nextDownSince("2026-07-24T08:00:00.000Z", false, NOW)).toBe("2026-07-24T08:00:00.000Z");
  });
  it("clears on recovery", () => {
    expect(nextDownSince("2026-07-24T08:00:00.000Z", true, NOW)).toBeNull();
  });
  it("leaves it untouched when the poll failed", () => {
    expect(nextDownSince("2026-07-24T08:00:00.000Z", null, NOW)).toBe("2026-07-24T08:00:00.000Z");
    expect(nextDownSince(null, null, NOW)).toBeNull();
  });
});

describe("isStale", () => {
  const NOW_MS = Date.parse("2026-07-24T10:00:00.000Z");
  it("never checked is stale", () => {
    expect(isStale(null, NOW_MS)).toBe(true);
  });
  it("fresh within 20 minutes", () => {
    expect(isStale("2026-07-24T09:50:00.000Z", NOW_MS)).toBe(false);
  });
  it("stale beyond 20 minutes", () => {
    expect(isStale("2026-07-24T09:30:00.000Z", NOW_MS)).toBe(true);
  });
});

describe("CONN_TYPE_LABELS", () => {
  it("labels each type", () => {
    expect(CONN_TYPE_LABELS.pppoe).toBe("PPPoE");
    expect(CONN_TYPE_LABELS.static).toBe("Static IP");
    expect(CONN_TYPE_LABELS.dhcp).toBe("Automatic (DHCP)");
  });
});
```

- [ ] **Step 2:** `npx vitest run lib/connectivity-helpers.test.ts` → FAIL (exports missing).
- [ ] **Step 3: append implementation** to `lib/connectivity-helpers.ts`:

```ts
export const CONN_TYPES = ["pppoe", "static", "dhcp"] as const;

export const CONN_TYPE_LABELS: Record<string, string> = {
  pppoe: "PPPoE",
  static: "Static IP",
  dhcp: "Automatic (DHCP)",
};

export type IcmpSample = { up: boolean | null; latencyMs: number | null; lossPct: number | null };

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** LibreNMS device payload → ICMP sample. Never throws; unknown on malformed. */
export function mapIcmp(device: unknown): IcmpSample {
  if (!device || typeof device !== "object") return { up: null, latencyMs: null, lossPct: null };
  const rec = device as Record<string, unknown>;
  const s = rec.status;
  const up = s === 1 || s === true || s === "1" ? true : s === 0 || s === false || s === "0" ? false : null;
  if (up === null) return { up: null, latencyMs: null, lossPct: null };
  return { up, latencyMs: numOrNull(rec.ping_avg), lossPct: numOrNull(rec.ping_loss) };
}

/** Outage start: stamped on the first down poll, held while down, cleared on
 *  recovery, untouched when the poll itself failed (up === null). */
export function nextDownSince(prevDownSince: string | null, up: boolean | null, nowIso: string): string | null {
  if (up === null) return prevDownSince;
  if (up) return null;
  return prevDownSince ?? nowIso;
}

/** True when we have no check, or the newest is older than 20 minutes. */
export function isStale(lastCheckedAt: string | null, nowMs: number): boolean {
  if (!lastCheckedAt) return true;
  return nowMs - Date.parse(lastCheckedAt) > 20 * 60 * 1000;
}
```

- [ ] **Step 4:** helper tests pass; `npm test` fully green.
- [ ] **Step 5:** commit `feat(connectivity): ICMP mapping, outage-start and staleness rules`.

---

### Task 2: Crypto helper `lib/secrets.ts` + tests

**Files:** Create `lib/secrets.ts`, `lib/secrets.test.ts`.

**Interfaces (produced):**
- `type Sealed = { ciphertext: string; iv: string; tag: string }`
- `encryptSecret(plaintext: string, keyBase64: string): Sealed`
- `decryptSecret(payload: Sealed, keyBase64: string): string`
- `connectivityKey(): string` — reads `CONNECTIVITY_ENC_KEY`, throws a clear error when unset.

Wire-compatible with `lib/m365-graph.mjs` (same AES-256-GCM, base64 fields).

- [ ] **Step 1: failing test** — `lib/secrets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./secrets";

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("secrets", () => {
  it("round-trips a value", () => {
    const sealed = encryptSecret("hunter2-pppoe", KEY);
    expect(sealed.ciphertext).not.toContain("hunter2");
    expect(decryptSecret(sealed, KEY)).toBe("hunter2-pppoe");
  });
  it("produces a fresh iv each time", () => {
    expect(encryptSecret("x", KEY).iv).not.toBe(encryptSecret("x", KEY).iv);
  });
  it("rejects a tampered payload", () => {
    const sealed = encryptSecret("secret", KEY);
    expect(() => decryptSecret({ ...sealed, ciphertext: Buffer.from("evil").toString("base64") }, KEY)).toThrow();
  });
  it("rejects a wrong-size key", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16, 1).toString("base64"))).toThrow(/32 bytes/);
  });
});
```

- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3: implement** — `lib/secrets.ts`:

```ts
import crypto from "node:crypto";

export type Sealed = { ciphertext: string; iv: string; tag: string };

function keyBuf(keyBase64: string): Buffer {
  const k = Buffer.from(keyBase64, "base64");
  if (k.length !== 32) throw new Error("encryption key must be 32 bytes (base64)");
  return k;
}

/** AES-256-GCM, wire-compatible with lib/m365-graph.mjs. */
export function encryptSecret(plaintext: string, keyBase64: string): Sealed {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf(keyBase64), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret({ ciphertext, iv, tag }: Sealed, keyBase64: string): string {
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf(keyBase64), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** The key protecting connectivity line credentials. */
export function connectivityKey(): string {
  const k = process.env.CONNECTIVITY_ENC_KEY;
  if (!k) throw new Error("CONNECTIVITY_ENC_KEY is not set");
  return k;
}
```

- [ ] **Step 4:** tests pass; `npm test` green.
- [ ] **Step 5:** commit `feat(connectivity): AES-256-GCM secret helpers for TS`.

---

### Task 3: Migration — settings, status columns, samples table

**Files:** Create `supabase/migrations/00NN_connectivity_slice2.sql` (NN = next free, expect 0070); regen `lib/types/database.ts`.

- [ ] **Step 1:** `ls supabase/migrations | tail -2` → pick the next number. Write:

```sql
-- Connectivity slice 2: what the line's settings are, a description, and the
-- live ICMP health written every 5 minutes by scripts/connectivity-pull.mjs
-- running on Vision (LibreNMS is tailnet-only, so the portal cannot poll it).
alter table public.connectivity_services
  add column description     text,
  add column conn_type       text not null default 'dhcp'
                               check (conn_type in ('pppoe','static','dhcp')),
  add column pppoe_username  text,
  -- {ciphertext, iv, tag} base64, AES-256-GCM (CONNECTIVITY_ENC_KEY).
  -- Never selected by client-facing list queries; only the reveal action reads it.
  add column pppoe_secret    jsonb,
  add column ip_address      text,
  add column subnet_mask     text,
  add column gateway         text,
  add column dns_servers     text,
  add column vlan            int,
  add column last_up         boolean,
  add column latency_ms      numeric,
  add column loss_pct        numeric,
  add column last_checked_at timestamptz,
  add column down_since      timestamptz;

-- Rolling ICMP history for the 24h trend. The pull prunes beyond 48h.
create table public.connectivity_samples (
  id         uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.connectivity_services(id) on delete cascade,
  at         timestamptz not null default now(),
  up         boolean,
  latency_ms numeric,
  loss_pct   numeric
);
create index connectivity_samples_service_at_idx on public.connectivity_samples (service_id, at desc);

alter table public.connectivity_samples enable row level security;
create policy connectivity_samples_staff on public.connectivity_samples
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
-- Clients read samples for their own active lines (mirrors the service policy).
create policy connectivity_samples_client_read on public.connectivity_samples
  for select using (
    exists (
      select 1 from public.connectivity_services s
      where s.id = service_id
        and s.client_id = public.current_client_id()
        and s.is_active
    )
  );
```

- [ ] **Step 2:** `cat supabase/.temp/project-ref` (must be `eskhokedsximnslgsycs`), `npx supabase db push --linked`.
- [ ] **Step 3:** `npx supabase gen types typescript --linked > lib/types/database.ts && npx tsc --noEmit` → clean.
- [ ] **Step 4:** commit `feat(connectivity): settings, live status columns and samples table`.

---

### Task 4: View layer + actions (stored status, reveal, edit)

**Files:** Modify `lib/views/connectivity.ts`, `lib/actions/connectivity.ts`; delete `lib/librenms.ts`.

**Interfaces (produced):**
- `ConnectivityLine` gains: `description: string | null; connType: string; pppoeUsername: string | null; hasSecret: boolean; ipAddress: string | null; subnetMask: string | null; gateway: string | null; dnsServers: string | null; vlan: number | null; lastUp: boolean | null; latencyMs: number | null; lossPct: number | null; lastCheckedAt: string | null; downSince: string | null; samples: { at: string; latencyMs: number | null }[]` — and **loses** `status` (the live-proxy shape).
- `revealPppoeSecret(serviceId: string): Promise<{ ok: true; secret: string } | { ok: false; error: string }>` (in actions).
- `addLine` / `updateLine` accept the new fields (password encrypted when non-empty; blank leaves the stored secret untouched).

- [ ] **Step 1: rewrite the view** `lib/views/connectivity.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { speedLabel } from "@/lib/connectivity-helpers";

export type ConnectivitySample = { at: string; latencyMs: number | null };

export type ConnectivityLine = {
  id: string;
  label: string;
  kind: string;
  provider: string | null;
  speed: string | null;
  description: string | null;
  connType: string;
  pppoeUsername: string | null;
  /** True when a password is stored — the value itself never ships here. */
  hasSecret: boolean;
  ipAddress: string | null;
  subnetMask: string | null;
  gateway: string | null;
  dnsServers: string | null;
  vlan: number | null;
  librenmsDeviceId: number | null;
  notes: string | null;
  isActive: boolean;
  lastUp: boolean | null;
  latencyMs: number | null;
  lossPct: number | null;
  lastCheckedAt: string | null;
  downSince: string | null;
  samples: ConnectivitySample[];
};

/** A client's lines with the status the pull last wrote, plus 24h of samples.
 *  RLS scopes rows; pppoe_secret is deliberately NOT selected here. */
export async function getConnectivityLines(
  clientId: string,
  opts?: { includeInactive?: boolean },
): Promise<ConnectivityLine[]> {
  const supabase = await createClient();
  let q = supabase
    .from("connectivity_services")
    .select(
      "id, label, kind, provider, download_mbps, upload_mbps, description, conn_type, pppoe_username, ip_address, subnet_mask, gateway, dns_servers, vlan, librenms_device_id, notes, is_active, last_up, latency_ms, loss_pct, last_checked_at, down_since, pppoe_secret",
    )
    .eq("client_id", clientId)
    .order("label");
  if (!opts?.includeInactive) q = q.eq("is_active", true);
  const { data } = await q;
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: sampleRows } = await supabase
    .from("connectivity_samples")
    .select("service_id, at, latency_ms")
    .in("service_id", rows.map((r) => r.id))
    .gte("at", since)
    .order("at");
  const byService = new Map<string, ConnectivitySample[]>();
  for (const s of sampleRows ?? []) {
    const list = byService.get(s.service_id) ?? [];
    list.push({ at: s.at, latencyMs: s.latency_ms == null ? null : Number(s.latency_ms) });
    byService.set(s.service_id, list);
  }

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    provider: r.provider,
    speed: speedLabel(r.download_mbps, r.upload_mbps),
    description: r.description,
    connType: r.conn_type,
    pppoeUsername: r.pppoe_username,
    hasSecret: !!r.pppoe_secret,
    ipAddress: r.ip_address,
    subnetMask: r.subnet_mask,
    gateway: r.gateway,
    dnsServers: r.dns_servers,
    vlan: r.vlan,
    librenmsDeviceId: r.librenms_device_id,
    notes: r.notes,
    isActive: r.is_active,
    lastUp: r.last_up,
    latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
    lossPct: r.loss_pct == null ? null : Number(r.loss_pct),
    lastCheckedAt: r.last_checked_at,
    downSince: r.down_since,
    samples: byService.get(r.id) ?? [],
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

Note: `pppoe_secret` is selected only to derive `hasSecret` — it is never placed
on the returned object.

- [ ] **Step 2: extend the actions** `lib/actions/connectivity.ts` — replace `lineFields` and add reveal:

```ts
import { canAccess, toOverrides } from "@/lib/feature-access";
import { connectivityKey, encryptSecret, decryptSecret, type Sealed } from "@/lib/secrets";
import { createServiceClient } from "@/lib/supabase/service";

const CONN_TYPES = ["pppoe", "static", "dhcp"];

function lineFields(fd: FormData) {
  const kind = String(fd.get("kind") ?? "fibre");
  const connType = String(fd.get("conn_type") ?? "dhcp");
  return {
    label: str(fd, "label"),
    kind: KINDS.includes(kind) ? kind : "other",
    provider: str(fd, "provider"),
    download_mbps: num(fd, "download_mbps"),
    upload_mbps: num(fd, "upload_mbps"),
    librenms_device_id: num(fd, "librenms_device_id"),
    notes: str(fd, "notes"),
    description: str(fd, "description"),
    conn_type: CONN_TYPES.includes(connType) ? connType : "dhcp",
    pppoe_username: str(fd, "pppoe_username"),
    ip_address: str(fd, "ip_address"),
    subnet_mask: str(fd, "subnet_mask"),
    gateway: str(fd, "gateway"),
    dns_servers: str(fd, "dns_servers"),
    vlan: num(fd, "vlan"),
  };
}

/** Seal a submitted password, or null when the field was left blank. */
function sealedFrom(fd: FormData): Sealed | null {
  const pw = str(fd, "pppoe_password");
  return pw ? encryptSecret(pw, connectivityKey()) : null;
}
```

`addLine`: `const sealed = sealedFrom(formData);` then insert
`{ client_id: clientId, label, ...fields, ...(sealed ? { pppoe_secret: sealed } : {}) }`.
`updateLine`: same, and **omit `pppoe_secret` entirely when blank** so an edit
never wipes a stored password.

Add the reveal action:

```ts
/** Decrypt a line's PPPoE password for this request only. Allowed for staff,
 *  or a manager of that client who still has the connectivity feature. */
export async function revealPppoeSecret(
  serviceId: string,
): Promise<{ ok: true; secret: string } | { ok: false; error: string }> {
  const me = await getCurrentProfile();
  if (!me.authenticated) return { ok: false, error: "Not signed in." };
  const service = createServiceClient();
  const { data: row } = await service
    .from("connectivity_services")
    .select("client_id, pppoe_secret, is_active")
    .eq("id", serviceId)
    .maybeSingle();
  if (!row?.pppoe_secret) return { ok: false, error: "No password stored for this line." };

  const isStaff = me.profile.role === "rocking_staff";
  const isTheirManager =
    me.profile.role === "client_manager" &&
    me.profile.client_id === row.client_id &&
    row.is_active &&
    canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "connectivity");
  if (!isStaff && !isTheirManager) return { ok: false, error: "Not allowed." };

  try {
    return { ok: true, secret: decryptSecret(row.pppoe_secret as unknown as Sealed, connectivityKey()) };
  } catch {
    return { ok: false, error: "Could not decrypt — check CONNECTIVITY_ENC_KEY." };
  }
}
```

- [ ] **Step 3:** `rm lib/librenms.ts` (the live proxy is retired; nothing else imports it — confirm with `grep -rn "lib/librenms" app lib components`).
- [ ] **Step 4:** `npx tsc --noEmit` clean.
- [ ] **Step 5:** commit `feat(connectivity): stored-status views, reveal action, settings fields`.

---

### Task 5: Client page — settings block, live row, sparkline

**Files:** Create `components/ConnectivityLineCard.tsx`, `components/RevealSecret.tsx`; modify `app/(app)/connectivity/page.tsx`.

**Interfaces:** `<ConnectivityLineCard line={ConnectivityLine} />` (server), `<RevealSecret serviceId={string} />` (client).

- [ ] **Step 1: reveal button** — `components/RevealSecret.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { revealPppoeSecret } from "@/lib/actions/connectivity";

/** Masked password with an explicit reveal — the value only ever crosses the
 *  wire when someone asks for it. */
export function RevealSecret({ serviceId }: { serviceId: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (secret) return <code className="rounded bg-line-soft px-1.5 py-0.5 text-[12.5px] text-ink">{secret}</code>;

  return (
    <span className="inline-flex items-center gap-2">
      <code className="rounded bg-line-soft px-1.5 py-0.5 text-[12.5px] text-faint">••••••••</code>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await revealPppoeSecret(serviceId);
            if (res.ok) setSecret(res.secret);
            else setErr(res.error);
          })
        }
        className="text-[12.5px] font-semibold text-ink-3 hover:text-ink disabled:opacity-60"
      >
        {pending ? "…" : "Reveal"}
      </button>
      {err && <span className="text-[12px] text-brand">{err}</span>}
    </span>
  );
}
```

- [ ] **Step 2: the card** — `components/ConnectivityLineCard.tsx`:

```tsx
import Link from "next/link";
import type { ConnectivityLine } from "@/lib/views/connectivity";
import { KIND_LABELS, CONN_TYPE_LABELS, isStale } from "@/lib/connectivity-helpers";
import { Card, StatusPill } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { RevealSecret } from "@/components/RevealSecret";

const fmtWhen = (iso: string) => iso.replace("T", " ").slice(0, 16);

function ago(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function Setting({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[13px]">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-ink-2">{value}</span>
    </div>
  );
}

/** One line: what it is, how it's configured, and how it's doing. */
export function ConnectivityLineCard({ line }: { line: ConnectivityLine }) {
  const nowMs = Date.now();
  const stale = isStale(line.lastCheckedAt, nowMs);
  const latencies = line.samples.map((s) => s.latencyMs).filter((n): n is number => n != null);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-semibold text-ink">{line.label}</span>
            {line.librenmsDeviceId == null ? null : stale ? (
              <StatusPill tone="warn" label={line.lastCheckedAt ? `Last checked ${fmtWhen(line.lastCheckedAt)}` : "Not checked yet"} />
            ) : line.lastUp === true ? (
              <StatusPill tone="good" label="Online" />
            ) : line.lastUp === false ? (
              <StatusPill tone="bad" label={line.downSince ? `Down since ${fmtWhen(line.downSince)}` : "Down"} />
            ) : (
              <StatusPill tone="warn" label="Status unavailable" />
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            {[KIND_LABELS[line.kind] ?? line.kind, line.speed, line.provider].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Link
          href={`/support/new?subject=${encodeURIComponent(`Line problem: ${line.label}`)}`}
          className="ml-auto shrink-0 rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-line-soft"
        >
          Report a problem
        </Link>
      </div>

      {line.description && <p className="border-b border-line-soft px-4 py-3 text-[13px] text-ink-2">{line.description}</p>}

      <div className="grid gap-4 px-4 py-3.5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-faint">Connection</div>
          <Setting label="Type" value={CONN_TYPE_LABELS[line.connType] ?? line.connType} />
          {line.connType === "pppoe" && (
            <>
              <Setting label="Username" value={line.pppoeUsername ?? "—"} />
              <Setting label="Password" value={line.hasSecret ? <RevealSecret serviceId={line.id} /> : "—"} />
            </>
          )}
          {line.connType === "static" && (
            <>
              <Setting label="IP address" value={line.ipAddress ?? "—"} />
              <Setting label="Subnet mask" value={line.subnetMask ?? "—"} />
              <Setting label="Gateway" value={line.gateway ?? "—"} />
              <Setting label="DNS" value={line.dnsServers ?? "—"} />
            </>
          )}
          {line.vlan != null && <Setting label="VLAN" value={line.vlan} />}
        </div>

        {line.librenmsDeviceId != null && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-faint">Health</div>
            <Setting label="Latency" value={line.latencyMs == null ? "—" : `${line.latencyMs.toFixed(1)} ms`} />
            <Setting label="Packet loss" value={line.lossPct == null ? "—" : `${line.lossPct}%`} />
            <Setting label="Checked" value={line.lastCheckedAt ? ago(line.lastCheckedAt, nowMs) : "—"} />
            {latencies.length >= 2 && (
              <div className="pt-1">
                <Sparkline values={latencies} width={200} height={32} />
                <p className="mt-1 text-[11px] text-faint">Latency, last 24 hours</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 3: use it** in `app/(app)/connectivity/page.tsx` — replace the inline card JSX with `{lines.map((l) => <ConnectivityLineCard key={l.id} line={l} />)}`, dropping the now-unused `Link`/`StatusPill`/`KIND_LABELS`/`fmtSince` imports.
- [ ] **Step 4:** `npm run build` clean.
- [ ] **Step 5:** commit `feat(connectivity): line cards with settings, health and 24h trend`.

---

### Task 6: Admin — settings fields + edit

**Files:** Modify `app/(admin)/admin/clients/[id]/ConnectivitySection.tsx`.

- [ ] **Step 1:** Extend the add form with the new inputs (same FIELD style, arranged on two wrapped rows): `description`, `conn_type` select (`pppoe|static|dhcp` via `CONN_TYPE_LABELS`), `pppoe_username`, `pppoe_password` (type="password", `autoComplete="new-password"`), `ip_address`, `subnet_mask`, `gateway`, `dns_servers`, `vlan`. All optional; the client card only renders what the type needs.
- [ ] **Step 2:** Add an edit form per line inside a `<details>` (summary "Edit") posting `updateLine.bind(null, l.id, clientId)`, prefilled with the line's current values; the password field is blank with placeholder `"leave blank to keep"` — matching the action's behaviour.
- [ ] **Step 3:** Show the live status inline per row: `Online · 12 ms · 0% loss` / `Down since …` / `Last checked …`, using the same rules as the client card (`isStale`).
- [ ] **Step 4:** `npm run build` clean.
- [ ] **Step 5:** commit `feat(connectivity): admin settings fields and per-line edit`.

---

### Task 7: The pull script for Vision

**Files:** Create `scripts/connectivity-pull.mjs`, `scripts/README-connectivity-pull.md`.

- [ ] **Step 1: the script** — self-contained ESM, config from a credentials file path in `$ROCKING_CONN_CONF` (default `/etc/rocking/conn-pull.json`), falling back to `.env.local` when run from the repo for local testing:

```js
// Connectivity pull — runs ON VISION (the LibreNMS box) every 5 minutes.
// LibreNMS is tailnet-only, so the portal can't poll it; this writes status
// into Supabase instead. Reads config from a chmod-600 JSON file:
//   { "supabaseUrl": "...", "serviceKey": "...", "librenmsUrl": "http://localhost", "librenmsKey": "..." }
import { readFileSync } from "node:fs";
import { mapIcmp, nextDownSince } from "../lib/connectivity-helpers.ts"; // see note below

const confPath = process.env.ROCKING_CONN_CONF ?? "/etc/rocking/conn-pull.json";
const conf = JSON.parse(readFileSync(confPath, "utf8"));
const H = { apikey: conf.serviceKey, Authorization: `Bearer ${conf.serviceKey}`, "Content-Type": "application/json" };
const nowIso = new Date().toISOString();

const rest = (path, init) => fetch(`${conf.supabaseUrl}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });

const lines = await (await rest("connectivity_services?is_active=eq.true&librenms_device_id=not.is.null&select=id,label,librenms_device_id,down_since")).json();
let ok = 0, failed = 0;

for (const line of lines) {
  let sample = { up: null, latencyMs: null, lossPct: null };
  try {
    const r = await fetch(`${conf.librenmsUrl.replace(/\/$/, "")}/api/v0/devices/${line.librenms_device_id}`, {
      headers: { "X-Auth-Token": conf.librenmsKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const body = await r.json();
    sample = mapIcmp(body?.devices?.[0] ?? null);
  } catch (e) {
    failed++;
    console.error(`${line.label}: ${e.message}`);
  }

  // A failed poll bumps the timestamp only — it must never look like an outage.
  const patch = sample.up === null
    ? { last_checked_at: nowIso }
    : {
        last_up: sample.up,
        latency_ms: sample.latencyMs,
        loss_pct: sample.lossPct,
        last_checked_at: nowIso,
        down_since: nextDownSince(line.down_since, sample.up, nowIso),
      };
  await rest(`connectivity_services?id=eq.${line.id}`, { method: "PATCH", body: JSON.stringify(patch) });

  if (sample.up !== null) {
    await rest("connectivity_samples", {
      method: "POST",
      body: JSON.stringify({ service_id: line.id, up: sample.up, latency_ms: sample.latencyMs, loss_pct: sample.lossPct }),
    });
    ok++;
  }
  const cutoff = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  await rest(`connectivity_samples?service_id=eq.${line.id}&at=lt.${cutoff}`, { method: "DELETE" });
}

console.log(`connectivity pull: ${ok} ok, ${failed} failed, ${lines.length} lines @ ${nowIso}`);
```

**Note on the import:** plain node cannot import the `.ts` helper. Copy the two
functions (`mapIcmp`, `nextDownSince`) inline into the script instead, with a
comment pointing at `lib/connectivity-helpers.ts` as the tested source of truth
— the same duplication the other `scripts/*.mjs` accept. Do NOT add a build step.

- [ ] **Step 2: runbook** — `scripts/README-connectivity-pull.md`: what it does, the config file shape, `chmod 600 /etc/rocking/conn-pull.json`, the crontab line `*/5 * * * * /usr/bin/node /opt/rocking/connectivity-pull.mjs >> /var/log/rocking-conn-pull.log 2>&1`, and how to test by hand (`ROCKING_CONN_CONF=… node scripts/connectivity-pull.mjs`).
- [ ] **Step 3:** commit `feat(connectivity): 5-minute ICMP pull for Vision + runbook`.

---

### Task 8: Verify + push

- [ ] **Step 1:** `npm test && npm run build` green.
- [ ] **Step 2:** Programmatic check (service key, from the repo): create a temp line on a real client with `conn_type='pppoe'`, encrypted secret written via a node one-liner using `lib/secrets.ts` logic, plus 3 fake samples; confirm `getConnectivityLines`-shaped SELECT returns them; confirm an **anon** query of `connectivity_samples` returns 0 rows; delete the temp line (cascade removes samples).
- [ ] **Step 3:** Push; deploy health-check `/connectivity` (expect 307 → /login).
- [ ] **Step 4:** Tell Shawn exactly what to do on Vision (config file + cron), and that `CONNECTIVITY_ENC_KEY` must be added to `.env.local` **and** Vercel before any PPPoE password can be saved or revealed.
