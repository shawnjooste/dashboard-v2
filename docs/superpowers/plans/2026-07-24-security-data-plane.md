# Security Data Plane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A materialized, deduplicated `security_events` stream (activity + posture, with a Rocking triage layer) normalized nightly from Datto/M365/network data, plus a thin staff-only `/admin/security` viewer.

**Architecture:** Pure mapping helpers (`lib/security/severity-map.mjs`, vitest-covered, importable by both the Node normalizer and the app) → `security_events` table (unique on client_id+source_ref, staff-only RLS) → standalone `scripts/security-normalize.mjs` running after the nightly pulls (launchd 03:00) → RLS view layer + triage action + minimal admin page.

**Tech Stack:** Node .mjs script (repo pull-script idioms), Supabase Postgres/RLS, Next.js 16, vitest.

**Spec:** `docs/superpowers/specs/2026-07-24-security-data-plane-design.md`

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs`; verify `cat supabase/.temp/project-ref` before push. Commands from repo root.
- Migration number **0051** (verify still free at build — parallel sessions; check `ls supabase/migrations` AND `npx supabase migration list --linked`).
- `security_events` RLS: staff-only select; NO client policies (sub-project E's decision). Normalizer writes via service role.
- Idempotency is non-negotiable: re-running the normalizer must produce zero new rows on unchanged sources (unique `(client_id, source_ref)`, ignore-duplicates for activity, upsert for posture).
- Posture resolution NEVER touches `triage_state` (source truth vs Rocking triage are separate).
- Severity levels exactly `info|low|medium|high|critical`; kinds `activity|posture`; triage `new|acknowledged|escalated|dismissed`.
- Severity/category mapping lives ONLY in `lib/security/severity-map.mjs` (pure data+functions, .mjs so the Node script imports it directly — xero-helpers precedent).
- launchd agent `com.rocking.security-normalize` at 03:00 (after datto 02:15, m365 02:30, xero 02:45); logs to `~/Library/Logs/rocking-security-normalize.log`.
- Design tokens/components per repo; quote parenthesized paths; stale `.git/index.lock` → remove and retry.
- Adversarial review (data-integrity focus) before push.

---

### Task 1: Severity map + source_ref builders (TDD)

**Files:**
- Create: `lib/security/severity-map.mjs`
- Test: `lib/security/severity-map.test.mjs`

**Interfaces (produced — Task 3 script and Task 4 view rely on these exact names):**
- `mapDattoAlert(priority: string|null): { category: "monitoring", severity: string }` — Critical→critical, High→high, Moderate→medium, else low
- `mapDattoAvPosture(): { category: "config", severity: "high" }`
- `mapDattoPatchPosture(patchStatus: string): { category: "config", severity: string } | null` — InstallError→medium, RebootRequired→low (either raw or spaced form, per lib/views/health.ts PATCH_ISSUE), anything else → null
- `mapM365Identity(mfaMethods: string[]): { category: "identity", severity: string }` — empty methods→critical (password-only), else high (weak methods)
- `mapM365SecurityDefaults(): { category: "config", severity: "medium" }`
- `mapM365AccountDisabled(): { category: "identity", severity: "medium" }`
- `mapNetworkDown(status: string): { category: "availability", severity: "medium" } | null` — offline/alerting → medium, else null
- `refDattoAlert(deviceUid: string, triggeredAt: string, message: string): string` — `datto:alert:<uid>:<iso>:<djb2(message)>`
- `refDattoAv(deviceUid: string)`, `refDattoPatch(deviceUid: string)`, `refM365Mfa(userId: string)`, `refM365SecDefaults(clientId: string)`, `refM365Disabled(userId: string)`, `refNetworkDown(sourceDeviceId: string)` — each returns a stable string, distinct per builder
- `hashText(s: string): string` — stable djb2 hex (for alert messages in refs)
- `postureToResolve(existingOpenRefs: string[], currentRefs: string[]): string[]` — refs open in DB but absent from the current source pass

- [ ] **Step 1: failing test** — `lib/security/severity-map.test.mjs`:

```js
import { describe, expect, it } from "vitest";
import {
  hashText, mapDattoAlert, mapDattoAvPosture, mapDattoPatchPosture,
  mapM365AccountDisabled, mapM365Identity, mapM365SecurityDefaults,
  mapNetworkDown, postureToResolve,
  refDattoAlert, refDattoAv, refM365Mfa, refNetworkDown,
} from "./severity-map.mjs";

describe("datto mappings", () => {
  it("maps alert priorities", () => {
    expect(mapDattoAlert("Critical")).toEqual({ category: "monitoring", severity: "critical" });
    expect(mapDattoAlert("High").severity).toBe("high");
    expect(mapDattoAlert("Moderate").severity).toBe("medium");
    expect(mapDattoAlert("Low").severity).toBe("low");
    expect(mapDattoAlert(null).severity).toBe("low");
  });
  it("AV off is a high config finding", () => {
    expect(mapDattoAvPosture()).toEqual({ category: "config", severity: "high" });
  });
  it("maps patch problems, ignores healthy states", () => {
    expect(mapDattoPatchPosture("InstallError")?.severity).toBe("medium");
    expect(mapDattoPatchPosture("Reboot Required")?.severity).toBe("low");
    expect(mapDattoPatchPosture("RebootRequired")?.severity).toBe("low");
    expect(mapDattoPatchPosture("Fully Patched")).toBeNull();
  });
});

describe("m365 mappings", () => {
  it("no methods at all is critical, weak methods high", () => {
    expect(mapM365Identity([]).severity).toBe("critical");
    expect(mapM365Identity(["sms"]).severity).toBe("high");
  });
  it("security defaults + disabled accounts map", () => {
    expect(mapM365SecurityDefaults().severity).toBe("medium");
    expect(mapM365AccountDisabled().category).toBe("identity");
  });
});

describe("network mapping", () => {
  it("offline and alerting are availability events, online is not", () => {
    expect(mapNetworkDown("offline")?.category).toBe("availability");
    expect(mapNetworkDown("alerting")?.severity).toBe("medium");
    expect(mapNetworkDown("online")).toBeNull();
  });
});

describe("source refs", () => {
  it("are stable and distinct", () => {
    const a = refDattoAlert("uid1", "2026-07-01T00:00:00Z", "AV off");
    expect(a).toBe(refDattoAlert("uid1", "2026-07-01T00:00:00Z", "AV off"));
    expect(a).not.toBe(refDattoAlert("uid1", "2026-07-01T00:00:00Z", "disk full"));
    expect(refDattoAv("uid1")).not.toBe(refM365Mfa("uid1"));
    expect(refNetworkDown("dev-9")).toContain("dev-9");
  });
  it("hashText is deterministic", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });
});

describe("postureToResolve", () => {
  it("returns refs open in db but gone from source", () => {
    expect(postureToResolve(["a", "b", "c"], ["b"])).toEqual(["a", "c"]);
  });
  it("empty db → nothing to resolve", () => {
    expect(postureToResolve([], ["x"])).toEqual([]);
  });
});
```

- [ ] **Step 2:** `npx vitest run lib/security/severity-map.test.mjs` → FAIL (module missing).
- [ ] **Step 3: implement** — `lib/security/severity-map.mjs`:

```js
/** Pure severity/category mapping + source_ref builders for the security
 *  data plane. .mjs so BOTH the Node normalizer script and the app import it.
 *  Tuning severity = editing this file + its test, never a schema change. */

export function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function mapDattoAlert(priority) {
  const p = (priority ?? "").toLowerCase();
  if (p === "critical") return { category: "monitoring", severity: "critical" };
  if (p === "high") return { category: "monitoring", severity: "high" };
  if (p === "moderate") return { category: "monitoring", severity: "medium" };
  return { category: "monitoring", severity: "low" };
}

export const mapDattoAvPosture = () => ({ category: "config", severity: "high" });

export function mapDattoPatchPosture(patchStatus) {
  const s = (patchStatus ?? "").replace(/\s+/g, "");
  if (s === "InstallError") return { category: "config", severity: "medium" };
  if (s === "RebootRequired") return { category: "config", severity: "low" };
  return null;
}

/** Licensed+enabled user without strong MFA: no methods at all → critical
 *  (password only), weak methods present → high. */
export function mapM365Identity(mfaMethods) {
  return { category: "identity", severity: mfaMethods.length === 0 ? "critical" : "high" };
}

export const mapM365SecurityDefaults = () => ({ category: "config", severity: "medium" });
export const mapM365AccountDisabled = () => ({ category: "identity", severity: "medium" });

export function mapNetworkDown(status) {
  return status === "offline" || status === "alerting"
    ? { category: "availability", severity: "medium" }
    : null;
}

export const refDattoAlert = (uid, triggeredAt, message) =>
  `datto:alert:${uid}:${triggeredAt}:${hashText(message)}`;
export const refDattoAv = (uid) => `datto:av_off:${uid}`;
export const refDattoPatch = (uid) => `datto:patch:${uid}`;
export const refM365Mfa = (userId) => `m365:mfa:${userId}`;
export const refM365SecDefaults = (clientId) => `m365:security_defaults:${clientId}`;
export const refM365Disabled = (userId) => `m365:account_disabled:${userId}`;
export const refNetworkDown = (sourceDeviceId) => `network:down:${sourceDeviceId}`;

/** Posture rows open in the DB whose weakness no longer appears in source. */
export function postureToResolve(existingOpenRefs, currentRefs) {
  const current = new Set(currentRefs);
  return existingOpenRefs.filter((r) => !current.has(r));
}
```

- [ ] **Step 4:** map tests pass; `npm test` fully green.
- [ ] **Step 5:** commit `feat(security): severity map + source_ref builders`.

---

### Task 2: Migration 0051 — security_events

**Files:**
- Create: `supabase/migrations/0051_security_events.sql`
- Modify: `lib/types/database.ts` (regenerated)

- [ ] **Step 1: migration** (verify 0051 is still the next free number first):

```sql
-- MDR sub-project A: the normalized security signal stream. Two kinds:
-- 'activity' (a thing happened; immutable) and 'posture' (a standing
-- weakness; one row, flips resolved when a sync sees it fixed). triage_state
-- is ROCKING's layer (agents later, staff now) — independent of source truth.
-- Written only by the normalizer (service role); staff-only reads. Client
-- visibility is sub-project E's decision — no client policies here.
create table public.security_events (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete cascade,
  kind          text not null check (kind in ('activity','posture')),
  source        text not null,
  category      text not null,
  severity      text not null check (severity in ('info','low','medium','high','critical')),
  entity_type   text,
  entity_id     text,
  entity_label  text,
  title         text not null,
  detail        text,
  context       jsonb,
  occurred_at   timestamptz not null,
  source_ref    text not null,
  resolved      boolean not null default false,
  resolved_at   timestamptz,
  triage_state  text not null default 'new'
                  check (triage_state in ('new','acknowledged','escalated','dismissed')),
  triage_note   text,
  triaged_by    uuid references public.profiles(id) on delete set null,
  triaged_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index security_events_ref_idx on public.security_events (client_id, source_ref);
create index security_events_client_at_idx on public.security_events (client_id, occurred_at desc);
create index security_events_sev_triage_idx on public.security_events (severity, triage_state);

alter table public.security_events enable row level security;
create policy security_events_staff on public.security_events
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
```

- [ ] **Step 2:** verify ref → `npx supabase db push --linked` → applied.
- [ ] **Step 3:** regen types (`npx supabase gen types typescript --linked > lib/types/database.ts`); clear any `.next` " 2" Finder-dupes if tsc complains; `npx tsc --noEmit` clean.
- [ ] **Step 4:** commit `feat(security): security_events table + staff RLS`.

---

### Task 3: The normalizer + schedule + first run

**Files:**
- Create: `scripts/security-normalize.mjs`
- Create: `~/Library/LaunchAgents/com.rocking.security-normalize.plist` (not committed — machine config, but documented in the script header)

**Interfaces:**
- Consumes: Task 1 exports; tables `device_alerts`, `devices` (av_ok, hostname, datto_uid, client_id), `device_patch_status`, `m365_users`, `m365_tenant`, `network_devices`; writes `security_events` + an `import_runs` row (`source: 'security-normalize'`).

- [ ] **Step 1: write the script** — `scripts/security-normalize.mjs` (env loading + `createClient` service-role idioms copied from `scripts/datto-pull.mjs`):

```js
// Normalizes already-ingested telemetry into security_events (MDR data plane).
// Runs AFTER the nightly pulls: launchd com.rocking.security-normalize @ 03:00.
//   node scripts/security-normalize.mjs          # all clients
// Idempotent: unique (client_id, source_ref); re-runs add nothing new.
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import {
  mapDattoAlert, mapDattoAvPosture, mapDattoPatchPosture,
  mapM365AccountDisabled, mapM365Identity, mapM365SecurityDefaults,
  mapNetworkDown, postureToResolve,
  refDattoAlert, refDattoAv, refDattoPatch,
  refM365Disabled, refM365Mfa, refM365SecDefaults, refNetworkDown,
} from "../lib/security/severity-map.mjs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const now = new Date().toISOString();
const counts = { activity: 0, postureOpen: 0, postureResolved: 0 };
const activityRows = [];
const postureRows = [];

// ---------- Datto: alerts (activity) + AV/patch (posture) ----------
const { data: devices, error: devErr } = await sb
  .from("devices")
  .select("id, client_id, datto_uid, hostname, av_ok");
if (devErr) throw devErr;
const devById = new Map(devices.map((d) => [d.id, d]));

const { data: alerts } = await sb
  .from("device_alerts")
  .select("device_id, triggered_at, message, priority, resolved, alert_policy");
for (const a of alerts ?? []) {
  const d = devById.get(a.device_id);
  if (!d) continue;
  const m = mapDattoAlert(a.priority);
  activityRows.push({
    client_id: d.client_id, kind: "activity", source: "datto",
    category: m.category, severity: m.severity,
    entity_type: "device", entity_id: d.datto_uid, entity_label: d.hostname,
    title: a.message.slice(0, 200), detail: a.alert_policy,
    context: { resolved_in_source: a.resolved },
    occurred_at: a.triggered_at,
    source_ref: refDattoAlert(d.datto_uid, a.triggered_at, a.message),
  });
}

for (const d of devices) {
  if (d.av_ok === false) {
    const m = mapDattoAvPosture();
    postureRows.push({
      client_id: d.client_id, kind: "posture", source: "datto",
      category: m.category, severity: m.severity,
      entity_type: "device", entity_id: d.datto_uid, entity_label: d.hostname,
      title: `Antivirus not running on ${d.hostname}`,
      occurred_at: now, source_ref: refDattoAv(d.datto_uid),
    });
  }
}
const { data: patch } = await sb.from("device_patch_status").select("device_id, patch_status");
for (const p of patch ?? []) {
  const d = devById.get(p.device_id);
  const m = d && mapDattoPatchPosture(p.patch_status);
  if (!d || !m) continue;
  postureRows.push({
    client_id: d.client_id, kind: "posture", source: "datto",
    category: m.category, severity: m.severity,
    entity_type: "device", entity_id: d.datto_uid, entity_label: d.hostname,
    title: `Patching problem on ${d.hostname}: ${p.patch_status}`,
    occurred_at: now, source_ref: refDattoPatch(d.datto_uid),
  });
}

// ---------- M365: identity posture + tenant config + disabled accounts ----------
const { data: m365 } = await sb
  .from("m365_users")
  .select("client_id, m365_user_id, display_name, user_principal_name, account_enabled, is_licensed, mfa_methods, mfa_strong");
for (const u of m365 ?? []) {
  if (u.is_licensed && u.account_enabled && !u.mfa_strong) {
    const m = mapM365Identity(u.mfa_methods ?? []);
    postureRows.push({
      client_id: u.client_id, kind: "posture", source: "m365",
      category: m.category, severity: m.severity,
      entity_type: "user", entity_id: u.m365_user_id,
      entity_label: u.display_name ?? u.user_principal_name,
      title:
        (u.mfa_methods ?? []).length === 0
          ? `${u.display_name ?? u.user_principal_name} signs in with password only`
          : `${u.display_name ?? u.user_principal_name} has no strong MFA method`,
      context: { mfa_methods: u.mfa_methods },
      occurred_at: now, source_ref: refM365Mfa(u.m365_user_id),
    });
  }
  // Disabled licensed account: one-time activity row (dedup by user). First
  // run emits currently-disabled accounts once; re-disable after re-enable
  // will NOT re-emit (v1 limitation — needs state history we don't keep yet).
  if (u.is_licensed && u.account_enabled === false) {
    const m = mapM365AccountDisabled();
    activityRows.push({
      client_id: u.client_id, kind: "activity", source: "m365",
      category: m.category, severity: m.severity,
      entity_type: "user", entity_id: u.m365_user_id,
      entity_label: u.display_name ?? u.user_principal_name,
      title: `Account disabled: ${u.display_name ?? u.user_principal_name}`,
      occurred_at: now, source_ref: refM365Disabled(u.m365_user_id),
    });
  }
}
const { data: tenants } = await sb
  .from("m365_tenant")
  .select("client_id, security_defaults_on, ca_policy_count");
for (const t of tenants ?? []) {
  if (t.security_defaults_on === false && (t.ca_policy_count ?? 0) === 0) {
    const m = mapM365SecurityDefaults();
    postureRows.push({
      client_id: t.client_id, kind: "posture", source: "m365",
      category: m.category, severity: m.severity,
      entity_type: "tenant", entity_id: t.client_id, entity_label: "Microsoft 365 tenant",
      title: "Security defaults off with no conditional access policies",
      occurred_at: now, source_ref: refM365SecDefaults(t.client_id),
    });
  }
}

// ---------- Network: down/alerting devices (activity) ----------
const { data: net } = await sb
  .from("network_devices")
  .select("client_id, source_device_id, name, kind, status, last_seen_at");
for (const n of net ?? []) {
  const m = mapNetworkDown(n.status);
  if (!m) continue;
  activityRows.push({
    client_id: n.client_id, kind: "activity", source: "network",
    category: m.category, severity: m.severity,
    entity_type: "site_device", entity_id: n.source_device_id,
    entity_label: n.name ?? n.source_device_id,
    title: `${n.name ?? "Network device"} is ${n.status}`,
    context: { kind: n.kind, last_seen_at: n.last_seen_at },
    occurred_at: n.last_seen_at ?? now, source_ref: refNetworkDown(n.source_device_id),
  });
}

// ---------- Write: activity insert-if-absent; posture upsert-open ----------
const CHUNK = 500;
for (let i = 0; i < activityRows.length; i += CHUNK) {
  const { error } = await sb
    .from("security_events")
    .upsert(activityRows.slice(i, i + CHUNK), { onConflict: "client_id,source_ref", ignoreDuplicates: true });
  if (error) throw error;
}
counts.activity = activityRows.length;

// Pass 1: insert new posture rows only (ignoreDuplicates keeps the original
// occurred_at = first-observed on existing rows, and never touches triage).
for (let i = 0; i < postureRows.length; i += CHUNK) {
  const { error } = await sb
    .from("security_events")
    .upsert(postureRows.slice(i, i + CHUNK), { onConflict: "client_id,source_ref", ignoreDuplicates: true });
  if (error) throw error;
}
// Pass 2: re-open previously-resolved rows whose weakness is back. Severity
// of long-open rows is NOT refreshed on mapping changes (accepted v1 cut —
// takes effect on resolve/re-open).
const currentByClient = new Map();
for (const r of postureRows) {
  if (!currentByClient.has(r.client_id)) currentByClient.set(r.client_id, []);
  currentByClient.get(r.client_id).push(r.source_ref);
}
for (const [clientId, refs] of currentByClient) {
  for (let i = 0; i < refs.length; i += CHUNK) {
    const { error } = await sb
      .from("security_events")
      .update({ resolved: false, resolved_at: null, updated_at: now })
      .eq("client_id", clientId)
      .eq("resolved", true)
      .in("source_ref", refs.slice(i, i + CHUNK));
    if (error) throw error;
  }
}
counts.postureOpen = postureRows.length;

// Resolve posture rows whose weakness vanished from source.
const { data: openPosture } = await sb
  .from("security_events")
  .select("id, client_id, source_ref")
  .eq("kind", "posture")
  .eq("resolved", false);
const currentRefs = postureRows.map((r) => `${r.client_id}|${r.source_ref}`);
const toResolve = postureToResolve(
  (openPosture ?? []).map((r) => `${r.client_id}|${r.source_ref}`),
  currentRefs,
);
const resolveIds = (openPosture ?? [])
  .filter((r) => toResolve.includes(`${r.client_id}|${r.source_ref}`))
  .map((r) => r.id);
for (let i = 0; i < resolveIds.length; i += CHUNK) {
  const { error } = await sb
    .from("security_events")
    .update({ resolved: true, resolved_at: now, updated_at: now })
    .in("id", resolveIds.slice(i, i + CHUNK));
  if (error) throw error;
}
counts.postureResolved = resolveIds.length;

await sb.from("import_runs").insert({
  source: "security-normalize",
  report_date: now.slice(0, 10),
  counts,
});
console.log("Security normalize complete:", JSON.stringify(counts, null, 1));
```

- [ ] **Step 2:** first run: `node scripts/security-normalize.mjs` → summary counts print.
- [ ] **Step 3: idempotency proof** — run again immediately; activity count identical, `security_events` row count unchanged between runs (check via REST count before/after).
- [ ] **Step 4: spot-checks** — unresolved `datto:av_off:*` rows == devices with `av_ok=false`; `m365:mfa:*` unresolved == licensed+enabled+!mfa_strong users; one client's numbers verified by hand.
- [ ] **Step 5:** launchd plist (copy `com.rocking.datto-pull.plist` pattern, Hour 3 Minute 0, program args `node scripts/security-normalize.mjs`) + `launchctl load`; `launchctl list | grep rocking` shows it.
- [ ] **Step 6:** commit `feat(security): nightly normalizer for the security event stream`.

---

### Task 4: View layer, triage action, /admin/security page, nav

**Files:**
- Create: `lib/views/security.ts`
- Create: `lib/actions/security.ts`
- Create: `app/(admin)/admin/security/page.tsx`
- Modify: `lib/nav.ts` (Services group, after Devices: `{ label: "Security", href: "/admin/security" }`)

**Interfaces:**
- Produces: `type SecurityEventRow = { id, kind, source, category, severity, clientId, clientName, entityLabel, title, detail, occurredAt, resolved, triageState }`; `getSecurityEvents(filters: { severity?: string; kind?: string; clientId?: string; triage?: string; openOnly?: boolean }): Promise<{ events: SecurityEventRow[]; capped: boolean; totals: Record<string, number> }>` (limit 500, totals keyed by severity for the summary strip); action `setTriage(eventId: string, formData: FormData)` (staff-guarded; writes triage_state/note + triaged_by/at; revalidates `/admin/security`).

- [ ] **Step 1: view layer** — `lib/views/security.ts`:

```ts
import { createClient } from "@/lib/supabase/server";

export type SecurityEventRow = {
  id: string;
  kind: string;
  source: string;
  category: string;
  severity: string;
  clientId: string;
  clientName: string;
  entityLabel: string | null;
  title: string;
  detail: string | null;
  occurredAt: string;
  resolved: boolean;
  triageState: string;
};

const CAP = 500;

export async function getSecurityEvents(filters: {
  severity?: string;
  kind?: string;
  clientId?: string;
  triage?: string;
  openOnly?: boolean;
}): Promise<{ events: SecurityEventRow[]; capped: boolean; totals: Record<string, number> }> {
  const supabase = await createClient();
  let q = supabase
    .from("security_events")
    .select("id, kind, source, category, severity, client_id, entity_label, title, detail, occurred_at, resolved, triage_state")
    .order("occurred_at", { ascending: false })
    .limit(CAP);
  if (filters.severity) q = q.eq("severity", filters.severity);
  if (filters.kind) q = q.eq("kind", filters.kind);
  if (filters.clientId) q = q.eq("client_id", filters.clientId);
  if (filters.triage) q = q.eq("triage_state", filters.triage);
  if (filters.openOnly) q = q.eq("resolved", false);
  const [{ data }, { data: clients }] = await Promise.all([q, supabase.from("clients").select("id, name")]);
  const name = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const events = (data ?? []).map((e) => ({
    id: e.id,
    kind: e.kind,
    source: e.source,
    category: e.category,
    severity: e.severity,
    clientId: e.client_id,
    clientName: name.get(e.client_id) ?? "—",
    entityLabel: e.entity_label,
    title: e.title,
    detail: e.detail,
    occurredAt: e.occurred_at,
    resolved: e.resolved,
    triageState: e.triage_state,
  }));
  const totals: Record<string, number> = {};
  for (const e of events) totals[e.severity] = (totals[e.severity] ?? 0) + 1;
  return { events, capped: (data?.length ?? 0) === CAP, totals };
}
```

- [ ] **Step 2: triage action** — `lib/actions/security.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";

const STATES = new Set(["new", "acknowledged", "escalated", "dismissed"]);

/** Staff-only: set Rocking's triage state on a security event. Source truth
 *  (resolved) is never touched here — that belongs to the normalizer. */
export async function setTriage(eventId: string, formData: FormData) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  const state = String(formData.get("triage_state") ?? "");
  if (!eventId || !STATES.has(state)) throw new Error("invalid triage state");
  const note = String(formData.get("triage_note") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase
    .from("security_events")
    .update({
      triage_state: state,
      triage_note: note,
      triaged_by: me.profile.id,
      triaged_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/security");
}
```

- [ ] **Step 3: the page** — `app/(admin)/admin/security/page.tsx`: staff guard + searchParams filters (severity / kind / client / triage / open-only as chip links + client dropdown form, exactly the `/admin/activity` pattern), a severity summary strip (5 pills with counts from `totals`, critical/high tinted `bg-brand-tint text-brand` / `bg-warn-tint text-warn-ink`), then a Card list: severity pill, kind + source tags, client, entity, title (detail as muted second line), occurred date, posture rows show open/resolved, and an inline triage form per row (select of the four states + optional note input + Save calling `setTriage.bind(null, e.id)`). Cap note when 500 hit. Full code follows the activity page's structure with the table swapped for these columns.
- [ ] **Step 4: nav** — Services group after Devices: `{ label: "Security", href: "/admin/security" }`.
- [ ] **Step 5:** `npm test && npm run build` → green, `/admin/security` in route list.
- [ ] **Step 6:** commit `feat(security): staff security viewer with triage`.

---

### Task 5: Verify + adversarial review + push

- [ ] **Step 1:** full `npm test && npm run build`.
- [ ] **Step 2: live checks** — counts match sources (AV-off, MFA posture); re-run normalizer → zero new rows; one triage round-trip via the DB (set acknowledged + note, confirm persisted, confirm a subsequent normalize run does NOT reset it); RLS: anon + client-JWT get zero `security_events` rows.
- [ ] **Step 3:** adversarial review subagent over the full diff — focus: dedup/idempotency correctness, posture resolution (can a resolved row wrongly stay open / an open row wrongly resolve, cross-client ref collisions), triage preservation across normalize runs, severity mapping fidelity to the spec table, staff-only RLS, script failure modes (partial writes).
- [ ] **Step 4:** fix findings, push, deploy health-check `/admin/security` (307 → login), and confirm the launchd agent is loaded for tonight's 03:00 run.
