# SOC Console (Sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the `security_events` stream as a working cross-client picture: a KPI tile + panel on the admin Overview, a by-client breakdown on `/admin/security`, and a per-client Security section on the client page.

**Architecture:** One pure, tested rollup helper (grouping + worst-first ranking) feeds one new view-layer function (`getSecurityOverview`), which three thin presentational consumers read. No migration, no new tables, no incident concept — B only reads what sub-project A already writes.

**Tech Stack:** Next.js 16 (server components), Supabase (RLS-scoped reads), vitest.

**Spec:** `docs/superpowers/specs/2026-07-24-soc-console-design.md`

## Global Constraints

- No migration, no schema change, no new columns. B is visibility only.
- No "incident" concept anywhere (that is sub-project D). No notifications of any kind. No posture score/grade.
- "Open" = `resolved = false`. Activity events never resolve, so they always count (accepted v1 behaviour, documented in the spec).
- Severity order everywhere: `critical > high > medium > low > info`.
- All reads stay staff-only via existing RLS on `security_events`; every surface keeps its existing staff guard.
- Ordering/ranking logic lives ONLY in `lib/security/rollup.ts` (pure, import-free, vitest-covered) — same discipline as A's `severity-map.mjs`.
- Reuse existing components/tokens: `Card`, `CardHeader`, `DashboardPanel`, `PageHeader`, and the severity tint classes already in `app/(admin)/admin/security/page.tsx` (`bg-brand-tint text-brand` critical, `bg-warn-tint text-warn-ink` high, `bg-line-soft` others).
- Do NOT touch `scripts/m365-pull.mjs` — a separate session is editing it.
- Quote parenthesized paths in shell commands. Stale `.next/* 2.*` files break tsc — `find .next -name "* 2.*" -delete` if it complains.

---

### Task 1: Rollup helper + tests (TDD)

**Files:**
- Create: `lib/security/rollup.ts`
- Test: `lib/security/rollup.test.ts`

**Interfaces (produced — Task 2 imports these):**
- `SEVERITY_ORDER: readonly string[]` — `["critical","high","medium","low","info"]`
- `type SeverityCounts = Record<string, number>`
- `type ClientRollup = { clientId: string; clientName: string; counts: SeverityCounts; topItems: T[] }` (generic over the event shape)
- `emptyCounts(): SeverityCounts` — all five severities at 0
- `severityRank(severity: string): number` — index in SEVERITY_ORDER, unknown → 99
- `rollupByClient<T extends { clientId: string; clientName: string; severity: string }>(events: T[]): ClientRollup<T>[]` — groups open events by client, counts by severity, picks up to 3 worst-first `topItems`, returns clients sorted worst-first (critical desc, then high, medium, low, info, then name A→Z). Clients with no events never appear (they aren't in the input).

- [ ] **Step 1: Write the failing test**

`lib/security/rollup.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyCounts, rollupByClient, severityRank, SEVERITY_ORDER } from "./rollup";

const ev = (clientId: string, clientName: string, severity: string, title = "t") => ({
  clientId,
  clientName,
  severity,
  title,
});

describe("severityRank", () => {
  it("ranks critical worst and info least", () => {
    expect(severityRank("critical")).toBeLessThan(severityRank("high"));
    expect(severityRank("high")).toBeLessThan(severityRank("medium"));
    expect(severityRank("info")).toBeLessThan(severityRank("nonsense"));
  });
});

describe("emptyCounts", () => {
  it("has every severity at zero", () => {
    const c = emptyCounts();
    for (const s of SEVERITY_ORDER) expect(c[s]).toBe(0);
  });
});

describe("rollupByClient", () => {
  it("groups by client and counts by severity", () => {
    const rows = rollupByClient([
      ev("c1", "Alpha", "critical"),
      ev("c1", "Alpha", "high"),
      ev("c1", "Alpha", "high"),
      ev("c2", "Beta", "medium"),
    ]);
    const alpha = rows.find((r) => r.clientId === "c1")!;
    expect(alpha.counts.critical).toBe(1);
    expect(alpha.counts.high).toBe(2);
    expect(alpha.counts.medium).toBe(0);
    expect(rows.find((r) => r.clientId === "c2")!.counts.medium).toBe(1);
  });

  it("sorts worst-first: critical dominates any number of highs", () => {
    const rows = rollupByClient([
      ev("c2", "Beta", "high"),
      ev("c2", "Beta", "high"),
      ev("c2", "Beta", "high"),
      ev("c1", "Alpha", "critical"),
    ]);
    expect(rows[0].clientId).toBe("c1");
  });

  it("breaks ties on the next severity down, then on name", () => {
    const rows = rollupByClient([
      ev("c1", "Zulu", "critical"),
      ev("c2", "Alpha", "critical"),
      ev("c2", "Alpha", "high"),
      ev("c3", "Mike", "critical"),
    ]);
    // Alpha has an extra high → first; Zulu and Mike tie on counts → name order
    expect(rows.map((r) => r.clientName)).toEqual(["Alpha", "Mike", "Zulu"]);
  });

  it("caps topItems at 3, worst-first", () => {
    const rows = rollupByClient([
      ev("c1", "Alpha", "low", "l"),
      ev("c1", "Alpha", "critical", "c"),
      ev("c1", "Alpha", "medium", "m"),
      ev("c1", "Alpha", "high", "h"),
    ]);
    expect(rows[0].topItems.map((i) => i.title)).toEqual(["c", "h", "m"]);
  });

  it("handles empty input", () => {
    expect(rollupByClient([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/security/rollup.test.ts`
Expected: FAIL — cannot find module `./rollup`.

- [ ] **Step 3: Implement**

`lib/security/rollup.ts`:

```ts
/** Pure grouping/ranking for the SOC console — no server imports
 *  (vitest-safe). "Which client is worst" is decided here and nowhere else. */

export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

export type SeverityCounts = Record<string, number>;

export type ClientRollup<T> = {
  clientId: string;
  clientName: string;
  counts: SeverityCounts;
  topItems: T[];
};

export function emptyCounts(): SeverityCounts {
  const c: SeverityCounts = {};
  for (const s of SEVERITY_ORDER) c[s] = 0;
  return c;
}

/** Lower is worse. Unknown severities sort last. */
export function severityRank(severity: string): number {
  const i = (SEVERITY_ORDER as readonly string[]).indexOf(severity);
  return i === -1 ? 99 : i;
}

/** Group open events by client, count by severity, keep the 3 worst items,
 *  and rank clients worst-first: more criticals wins; ties fall through to
 *  high, medium, low, info; a full tie sorts by client name. */
export function rollupByClient<T extends { clientId: string; clientName: string; severity: string }>(
  events: T[],
): ClientRollup<T>[] {
  const byClient = new Map<string, ClientRollup<T>>();
  for (const e of events) {
    let row = byClient.get(e.clientId);
    if (!row) {
      row = { clientId: e.clientId, clientName: e.clientName, counts: emptyCounts(), topItems: [] };
      byClient.set(e.clientId, row);
    }
    row.counts[e.severity] = (row.counts[e.severity] ?? 0) + 1;
    row.topItems.push(e);
  }
  for (const row of byClient.values()) {
    row.topItems.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    row.topItems = row.topItems.slice(0, 3);
  }
  return [...byClient.values()].sort((a, b) => {
    for (const s of SEVERITY_ORDER) {
      const diff = (b.counts[s] ?? 0) - (a.counts[s] ?? 0);
      if (diff !== 0) return diff;
    }
    return a.clientName.localeCompare(b.clientName);
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/security/rollup.test.ts` → 7 pass. Then `npm test` → whole suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/security/rollup.ts lib/security/rollup.test.ts
git commit -m "feat(security): pure client rollup + worst-first ranking"
```

---

### Task 2: `getSecurityOverview()` view function

**Files:**
- Modify: `lib/views/security.ts` (append; leave `getSecurityEvents` untouched)

**Interfaces:**
- Consumes: Task 1's `emptyCounts`, `rollupByClient`, `SEVERITY_ORDER`, `ClientRollup`; the existing `SecurityEventRow` type in this file.
- Produces: `type SecurityOverview = { totals: SeverityCounts; byClient: ClientRollup<SecurityEventRow>[] }` and `getSecurityOverview(): Promise<SecurityOverview>`. Tasks 3–5 consume this.

- [ ] **Step 1: Append the function**

Add to `lib/views/security.ts` (imports go at the top of the file alongside the existing `createClient` import):

```ts
import { emptyCounts, rollupByClient, type ClientRollup, type SeverityCounts } from "@/lib/security/rollup";
```

```ts
export type SecurityOverview = {
  totals: SeverityCounts;
  byClient: ClientRollup<SecurityEventRow>[];
};

/** Open security events rolled up per client, worst-first — the SOC console's
 *  single source. Staff-only by RLS, same as getSecurityEvents. "Open" means
 *  resolved = false; activity events never resolve, so they always count. */
export async function getSecurityOverview(): Promise<SecurityOverview> {
  const supabase = await createClient();
  const [{ data, error }, { data: clients }] = await Promise.all([
    supabase
      .from("security_events")
      .select("id, kind, source, category, severity, client_id, entity_label, title, detail, occurred_at, resolved, triage_state")
      .eq("resolved", false)
      .order("occurred_at", { ascending: false })
      .limit(2000),
    supabase.from("clients").select("id, name"),
  ]);
  if (error) throw new Error(error.message);
  const name = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const events: SecurityEventRow[] = (data ?? []).map((e) => ({
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
  const totals = emptyCounts();
  for (const e of events) totals[e.severity] = (totals[e.severity] ?? 0) + 1;
  return { totals, byClient: rollupByClient(events) };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` (first `find .next -name "* 2.*" -delete` if it reports `.next` duplicate-identifier noise)
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/views/security.ts
git commit -m "feat(security): getSecurityOverview rollup query"
```

---

### Task 3: Admin Overview tile + panel

**Files:**
- Modify: `lib/views/admin-dashboard.ts` (add a `security` field to `AdminDashboard`)
- Modify: `app/(admin)/admin/page.tsx` (sixth KPI tile + new panel)

**Interfaces:**
- Consumes: `getSecurityOverview` (Task 2); existing `DashItem`/`DashPanel` types and `DashboardPanel` component.
- Produces: `AdminDashboard["security"]` = `DashPanel & { criticalHigh: number }`.

- [ ] **Step 1: Extend the dashboard view**

In `lib/views/admin-dashboard.ts`, add the import:

```ts
import { getSecurityOverview } from "./security";
```

add to the `AdminDashboard` type (after `jobs`):

```ts
  /** Open critical/high security findings across all clients. */
  security: DashPanel & { criticalHigh: number };
```

add `getSecurityOverview()` to the existing `Promise.all([...])` (append at the end, destructuring as `securityOverview`), then build the panel before the `return`:

```ts
  // Security — the worst open findings across every client.
  const secEvents = securityOverview.byClient.flatMap((c) => c.topItems);
  const worst = secEvents
    .filter((e) => e.severity === "critical" || e.severity === "high")
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
  const securityPanel: AdminDashboard["security"] = {
    criticalHigh: (securityOverview.totals.critical ?? 0) + (securityOverview.totals.high ?? 0),
    count: worst.length,
    items: worst.slice(0, TOP).map((e) => ({
      id: e.id,
      primary: e.title,
      secondary: `${e.clientName} · ${e.severity}`,
      href: "/admin/security",
    })),
  };
```

and add `security: securityPanel,` to the returned object.

- [ ] **Step 2: Add the tile and panel to the page**

In `app/(admin)/admin/page.tsx`, add a sixth entry to the `kpis` array:

```ts
    {
      label: "SECURITY",
      value: String(d.security.criticalHigh),
      dot: d.security.criticalHigh > 0 ? "#B91C1C" : "#18181B",
    },
```

change the KPI grid class from `lg:grid-cols-5` to `lg:grid-cols-6`, and add a panel as the first entry in the action-panels grid (before "Approvals waiting"):

```tsx
        <DashboardPanel
          title="Security needs attention"
          count={d.security.count}
          hot
          items={d.security.items}
          viewAll={{ label: "Open security", href: "/admin/security" }}
          empty="Nothing critical open — the fleet looks clean."
        />
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add lib/views/admin-dashboard.ts "app/(admin)/admin/page.tsx"
git commit -m "feat(security): security tile + panel on the admin overview"
```

---

### Task 4: By-client breakdown on `/admin/security`

**Files:**
- Modify: `app/(admin)/admin/security/page.tsx` (insert a Card above the existing filters; leave the filters, event list and triage controls untouched)

**Interfaces:**
- Consumes: `getSecurityOverview` (Task 2), `SEVERITY_ORDER` (Task 1).

- [ ] **Step 1: Add the by-client table**

In `app/(admin)/admin/security/page.tsx`: import `getSecurityOverview` from `@/lib/views/security` and `SEVERITY_ORDER` from `@/lib/security/rollup`, call it alongside the existing `getSecurityEvents` call:

```ts
  const [{ events, capped, totals }, overview] = await Promise.all([
    getSecurityEvents({ severity, kind, clientId, triage, openOnly }),
    getSecurityOverview(),
  ]);
```

then render this Card immediately after the `<PageHeader …/>` and before the existing severity summary strip:

```tsx
      <Card>
        <CardHeader title="By client" count={overview.byClient.length} />
        {overview.byClient.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No open findings anywhere. Quiet day.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Client</th>
                {SEVERITY_ORDER.map((s) => (
                  <th key={s} className="px-4 py-2.5 font-semibold capitalize">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overview.byClient.map((c) => (
                <tr key={c.clientId} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5 font-medium">
                    <Link href={`/admin/security?client=${c.clientId}`} className="text-ink hover:text-brand">
                      {c.clientName}
                    </Link>
                  </td>
                  {SEVERITY_ORDER.map((s) => {
                    const n = c.counts[s] ?? 0;
                    const tone =
                      n === 0
                        ? "text-faint"
                        : s === "critical"
                          ? "font-semibold text-brand"
                          : s === "high"
                            ? "font-semibold text-warn-ink"
                            : "text-ink-2";
                    return (
                      <td key={s} className={`px-4 py-2.5 ${tone}`}>
                        {n}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/security/page.tsx"
git commit -m "feat(security): by-client breakdown on the security page"
```

---

### Task 5: Per-client SecuritySection

**Files:**
- Create: `app/(admin)/admin/clients/[id]/SecuritySection.tsx`
- Modify: `app/(admin)/admin/clients/[id]/page.tsx` (render it after `SupportSection`)

**Interfaces:**
- Consumes: `getSecurityOverview` (Task 2), `SEVERITY_ORDER` (Task 1), `Card`/`CardHeader`.
- Produces: `<SecuritySection clientId={string} />`.

- [ ] **Step 1: Write the component**

`app/(admin)/admin/clients/[id]/SecuritySection.tsx`:

```tsx
import Link from "next/link";
import { getSecurityOverview } from "@/lib/views/security";
import { SEVERITY_ORDER } from "@/lib/security/rollup";
import { Card, CardHeader } from "@/components/ui";

const TONE: Record<string, string> = {
  critical: "bg-brand-tint text-brand",
  high: "bg-warn-tint text-warn-ink",
  medium: "bg-line-soft text-ink-2",
  low: "bg-line-soft text-ink-3",
  info: "bg-line-soft text-faint",
};

/** Staff-only: this client's open security findings at a glance. Reads the
 *  same rollup the SOC console uses, so the numbers always agree. */
export async function SecuritySection({ clientId }: { clientId: string }) {
  const overview = await getSecurityOverview();
  const mine = overview.byClient.find((c) => c.clientId === clientId);
  const open = mine ? SEVERITY_ORDER.reduce((n, s) => n + (mine.counts[s] ?? 0), 0) : 0;

  return (
    <Card>
      <CardHeader title="Security" count={open} />
      {!mine || open === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No open security findings.</p>
      ) : (
        <div className="px-4 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            {SEVERITY_ORDER.filter((s) => (mine.counts[s] ?? 0) > 0).map((s) => (
              <span
                key={s}
                className={`rounded-full px-2.5 py-1 text-[12px] font-semibold capitalize ${TONE[s]}`}
              >
                {mine.counts[s]} {s}
              </span>
            ))}
            <Link
              href={`/admin/security?client=${clientId}`}
              className="ml-auto text-[13px] font-semibold text-ink-3 hover:text-brand"
            >
              View all →
            </Link>
          </div>
          <ul className="mt-3 space-y-1.5">
            {mine.topItems.map((e) => (
              <li key={e.id} className="flex items-baseline gap-2 text-sm">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold capitalize ${TONE[e.severity]}`}>
                  {e.severity}
                </span>
                <span className="min-w-0 text-ink">{e.title}</span>
                {e.entityLabel && <span className="shrink-0 text-xs text-faint">{e.entityLabel}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Render it on the client page**

In `app/(admin)/admin/clients/[id]/page.tsx`: add `import { SecuritySection } from "./SecuritySection";` and render `<SecuritySection clientId={id} />` directly after `<SupportSection clientId={id} />`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(admin)/admin/clients/[id]/SecuritySection.tsx" "app/(admin)/admin/clients/[id]/page.tsx"
git commit -m "feat(security): per-client security section on the client page"
```

---

### Task 6: Verify + push

- [ ] **Step 1:** `npm test && npm run build` — both green.
- [ ] **Step 2: cross-surface consistency check** — query the DB directly for open events grouped by client and severity (service-role script, same idiom as sub-project A's verification), and confirm: the Overview tile equals `critical + high` summed across clients; the `/admin/security` by-client table rows match the query; the client page section for one specific client matches that client's row. Any disagreement between surfaces means the shared rollup isn't actually shared — fix before push.
- [ ] **Step 3:** Push to `main`; after deploy, health-check `/admin/security` and `/admin` (both should 307 → login when unauthenticated).
