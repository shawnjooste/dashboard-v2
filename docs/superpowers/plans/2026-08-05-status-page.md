# Status Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff post and update incidents (global or client-scoped); clients see the ones that affect them, a coloured dot in the top bar, a permanent history, and optional email updates.

**Architecture:** Pure helpers decide severity ranking and email recipients. One migration adds three tables plus a subscription table, all sharing a single visibility rule in RLS. A view layer feeds two surfaces: `/status` (both audiences, staff controls inline) and a top-bar indicator computed in both layouts. Staff actions write an incident + its first update in one call and fan out per-recipient emails through the existing `lib/email/send.ts` chokepoint.

**Tech Stack:** Next.js 16 (server components + actions), Supabase Postgres/RLS, Resend via `lib/email/send.ts`, vitest.

**Spec:** `docs/superpowers/specs/2026-08-05-status-page-design.md`

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs`; verify `cat supabase/.temp/project-ref` before any push.
- Migration number: use the next free one (spec assumes `0079`) — **verify with `ls supabase/migrations` AND `npx supabase migration list --linked` first**; parallel sessions are active and have collided before.
- Types exactly: `outage` | `degraded` | `maintenance`. Status: `active` | `resolved`. Scope: `global` | `clients`.
- Severity order (worst first): `outage` > `degraded` > `maintenance` > none. Dot colours: red `#B91C1C`, amber `#B45309`, blue `#185FA5`, green `#15803D`.
- Visibility rule everywhere: staff see all; a client sees an incident when `scope='global'` OR their `current_client_id()` is in `status_incident_clients`.
- History is never deleted. Resolved incidents stay.
- Email is opt-in per user (a `status_subscriptions` row = subscribed); unsubscribe = delete the row via the same toggle. No public/tokenised unsubscribe route in v1.
- **Send one email per recipient**, each with its own `clientId` — never a shared `to:` array (it would leak client addresses to each other and misfile the `sent_emails` record).
- Email sends are best-effort: a failure is logged and MUST NOT block posting an incident.
- Staff are never emailed (they post).
- Pure helpers live in import-free files with vitest coverage (repo convention).
- Reuse existing components/tokens: `Card`, `CardHeader`, `PageHeader` from `@/components/ui`; `FIELD` input style as used in `app/(admin)/admin/security/page.tsx`.
- Quote parenthesized paths in shell. If `tsc` reports `.next/* 2.*` duplicate-identifier noise, run `find .next -name "* 2.*" -delete`.

---

### Task 1: Pure helpers + tests (TDD)

**Files:**
- Create: `lib/status-helpers.ts`
- Test: `lib/status-helpers.test.ts`

**Interfaces (produced — Tasks 3–6 import these):**
- `INCIDENT_TYPES: readonly ["outage","degraded","maintenance"]`
- `TYPE_LABELS: Record<string,string>` — `{outage:"Outage", degraded:"Degraded", maintenance:"Maintenance"}`
- `typeRank(type: string): number` — 0 outage, 1 degraded, 2 maintenance, 99 unknown
- `worstType(types: string[]): string | null` — worst present, else null
- `dotColour(type: string | null): string` — hex; null → green
- `statusLabel(type: string | null): string` — null → "All systems operational"
- `subjectFor(title: string, type: string, resolved: boolean): string` — `[Resolved] title` when resolved, else `[Outage] title` etc.
- `type Subscriber = { profileId: string; email: string; clientId: string | null; role: string }`
- `resolveRecipients(subs: Subscriber[], incident: { scope: string; clientIds: string[] }): Subscriber[]` — excludes staff, dedupes by profileId, global → all, clients → only matching clientId

- [ ] **Step 1: Write the failing test**

`lib/status-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  dotColour, resolveRecipients, statusLabel, subjectFor, typeRank, worstType,
  type Subscriber,
} from "./status-helpers";

describe("typeRank / worstType", () => {
  it("ranks outage worst and maintenance least", () => {
    expect(typeRank("outage")).toBeLessThan(typeRank("degraded"));
    expect(typeRank("degraded")).toBeLessThan(typeRank("maintenance"));
    expect(typeRank("nonsense")).toBe(99);
  });
  it("picks the worst present type", () => {
    expect(worstType(["maintenance", "outage", "degraded"])).toBe("outage");
    expect(worstType(["maintenance", "degraded"])).toBe("degraded");
    expect(worstType(["maintenance"])).toBe("maintenance");
  });
  it("returns null when nothing is active", () => {
    expect(worstType([])).toBeNull();
  });
  it("ignores unknown types rather than ranking them worst", () => {
    expect(worstType(["nonsense", "degraded"])).toBe("degraded");
  });
});

describe("dotColour / statusLabel", () => {
  it("is green with nothing active", () => {
    expect(dotColour(null)).toBe("#15803D");
    expect(statusLabel(null)).toBe("All systems operational");
  });
  it("is red for an outage", () => {
    expect(dotColour("outage")).toBe("#B91C1C");
    expect(statusLabel("outage")).toContain("Outage");
  });
});

describe("subjectFor", () => {
  it("prefixes with the type while active", () => {
    expect(subjectFor("Fibre down at GSR", "outage", false)).toBe("[Outage] Fibre down at GSR");
    expect(subjectFor("Slow email", "degraded", false)).toBe("[Degraded] Slow email");
  });
  it("prefixes with Resolved once resolved, whatever the type", () => {
    expect(subjectFor("Fibre down at GSR", "outage", true)).toBe("[Resolved] Fibre down at GSR");
  });
});

describe("resolveRecipients", () => {
  const subs: Subscriber[] = [
    { profileId: "p1", email: "a@gsr.co.za", clientId: "gsr", role: "client_manager" },
    { profileId: "p2", email: "b@gsr.co.za", clientId: "gsr", role: "client_member" },
    { profileId: "p3", email: "c@other.co.za", clientId: "other", role: "client_manager" },
    { profileId: "p4", email: "staff@rocking.one", clientId: null, role: "rocking_staff" },
  ];

  it("global reaches every subscribed client user", () => {
    const out = resolveRecipients(subs, { scope: "global", clientIds: [] });
    expect(out.map((r) => r.profileId).sort()).toEqual(["p1", "p2", "p3"]);
  });
  it("never emails staff", () => {
    const out = resolveRecipients(subs, { scope: "global", clientIds: [] });
    expect(out.some((r) => r.role === "rocking_staff")).toBe(false);
  });
  it("client-scoped reaches only the targeted client", () => {
    const out = resolveRecipients(subs, { scope: "clients", clientIds: ["gsr"] });
    expect(out.map((r) => r.profileId).sort()).toEqual(["p1", "p2"]);
  });
  it("client-scoped with no targets reaches nobody", () => {
    expect(resolveRecipients(subs, { scope: "clients", clientIds: [] })).toEqual([]);
  });
  it("dedupes a profile listed twice", () => {
    const dupes = [...subs, subs[0]];
    const out = resolveRecipients(dupes, { scope: "clients", clientIds: ["gsr"] });
    expect(out.filter((r) => r.profileId === "p1")).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/status-helpers.test.ts`
Expected: FAIL — cannot find module `./status-helpers`.

- [ ] **Step 3: Implement**

`lib/status-helpers.ts`:

```ts
/** Pure status-page logic — no server imports (vitest-safe). Severity
 *  ranking and email-recipient resolution live here and nowhere else. */

export const INCIDENT_TYPES = ["outage", "degraded", "maintenance"] as const;

export const TYPE_LABELS: Record<string, string> = {
  outage: "Outage",
  degraded: "Degraded",
  maintenance: "Maintenance",
};

const COLOURS: Record<string, string> = {
  outage: "#B91C1C",
  degraded: "#B45309",
  maintenance: "#185FA5",
};
const GREEN = "#15803D";

/** Lower is worse. Unknown types sort last and are never "worst". */
export function typeRank(type: string): number {
  const i = (INCIDENT_TYPES as readonly string[]).indexOf(type);
  return i === -1 ? 99 : i;
}

/** The worst active type, or null when nothing is active. */
export function worstType(types: string[]): string | null {
  const known = types.filter((t) => typeRank(t) !== 99);
  if (known.length === 0) return null;
  return known.reduce((worst, t) => (typeRank(t) < typeRank(worst) ? t : worst));
}

export function dotColour(type: string | null): string {
  return type ? (COLOURS[type] ?? GREEN) : GREEN;
}

export function statusLabel(type: string | null): string {
  if (!type) return "All systems operational";
  if (type === "outage") return "Outage in progress";
  if (type === "degraded") return "Degraded service";
  return "Scheduled maintenance";
}

/** Email subject: resolution always reads as resolved, whatever the type. */
export function subjectFor(title: string, type: string, resolved: boolean): string {
  const prefix = resolved ? "Resolved" : (TYPE_LABELS[type] ?? "Update");
  return `[${prefix}] ${title}`;
}

export type Subscriber = {
  profileId: string;
  email: string;
  clientId: string | null;
  role: string;
};

/** Who gets emailed about this incident: subscribed client users only,
 *  narrowed to the targeted clients when the incident is client-scoped.
 *  Staff post incidents; they are never emailed about them. */
export function resolveRecipients(
  subs: Subscriber[],
  incident: { scope: string; clientIds: string[] },
): Subscriber[] {
  const targets = new Set(incident.clientIds);
  const seen = new Set<string>();
  const out: Subscriber[] = [];
  for (const s of subs) {
    if (s.role === "rocking_staff") continue;
    if (incident.scope === "clients" && (!s.clientId || !targets.has(s.clientId))) continue;
    if (seen.has(s.profileId)) continue;
    seen.add(s.profileId);
    out.push(s);
  }
  return out;
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run lib/status-helpers.test.ts` → 14 pass. Then `npm test` → whole suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/status-helpers.ts lib/status-helpers.test.ts
git commit -m "feat(status): severity ranking + email recipient resolution"
```

---

### Task 2: Migration — tables, RLS, types

**Files:**
- Create: `supabase/migrations/0079_status_page.sql` (confirm the number is free first)
- Modify: `lib/types/database.ts` (regenerated)

- [ ] **Step 1: Confirm the migration number**

Run: `ls supabase/migrations | tail -3 && npx supabase migration list --linked | tail -5`
If `0079` is taken, use the next free number and keep the `_status_page` suffix.

- [ ] **Step 2: Write the migration**

```sql
-- Status page: staff post incidents (global or client-scoped), update them as
-- things develop, and resolve them. Clients see what affects them plus a
-- permanent history, and can opt into email updates.
-- Spec: docs/superpowers/specs/2026-08-05-status-page-design.md

create table public.status_incidents (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  type        text not null check (type in ('outage','degraded','maintenance')),
  status      text not null default 'active' check (status in ('active','resolved')),
  scope       text not null check (scope in ('global','clients')),
  started_at  timestamptz not null default now(),
  resolved_at timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index status_incidents_active_idx on public.status_incidents (status, started_at desc);

-- Targets for scope='clients'. A global incident has no rows here.
create table public.status_incident_clients (
  incident_id uuid not null references public.status_incidents(id) on delete cascade,
  client_id   uuid not null references public.clients(id) on delete cascade,
  primary key (incident_id, client_id)
);
create index status_incident_clients_client_idx on public.status_incident_clients (client_id);

-- The thread. Creating an incident always writes update #1, so an incident is
-- never a headline with no story. Resolution is an update too.
create table public.status_updates (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references public.status_incidents(id) on delete cascade,
  body          text not null,
  is_resolution boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index status_updates_incident_idx on public.status_updates (incident_id, created_at desc);

-- Per-user opt-in. Row present = subscribed; unsubscribing deletes it.
create table public.status_subscriptions (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Can the caller see this incident? Staff: everything. Client: global
-- incidents, plus any incident targeted at their client. SECURITY DEFINER so
-- the membership lookup isn't itself subject to RLS (and can't recurse).
create or replace function public.can_see_incident(p_incident_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.is_rocking_staff()
    or exists (
      select 1 from public.status_incidents i
      where i.id = p_incident_id and i.scope = 'global'
    )
    or exists (
      select 1 from public.status_incident_clients sic
      where sic.incident_id = p_incident_id
        and sic.client_id = public.current_client_id()
    );
$$;
grant execute on function public.can_see_incident(uuid) to authenticated;

alter table public.status_incidents        enable row level security;
alter table public.status_incident_clients enable row level security;
alter table public.status_updates          enable row level security;
alter table public.status_subscriptions    enable row level security;

-- Incidents: everyone reads what they may see; only staff write.
create policy status_incidents_read on public.status_incidents
  for select using (
    public.is_rocking_staff()
    or scope = 'global'
    or exists (
      select 1 from public.status_incident_clients sic
      where sic.incident_id = id and sic.client_id = public.current_client_id()
    )
  );
create policy status_incidents_staff on public.status_incidents
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

create policy status_incident_clients_read on public.status_incident_clients
  for select using (public.can_see_incident(incident_id));
create policy status_incident_clients_staff on public.status_incident_clients
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

create policy status_updates_read on public.status_updates
  for select using (public.can_see_incident(incident_id));
create policy status_updates_staff on public.status_updates
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Subscriptions: a user manages only their own; staff may read all.
create policy status_subscriptions_own on public.status_subscriptions
  for all using (profile_id = auth.uid()) with check (profile_id = auth.uid());
create policy status_subscriptions_staff_read on public.status_subscriptions
  for select using (public.is_rocking_staff());
```

- [ ] **Step 3: Push and regenerate types**

Run: `cat supabase/.temp/project-ref` (must be `eskhokedsximnslgsycs`), then
`npx supabase db push --linked`, then
`npx supabase gen types typescript --linked > lib/types/database.ts`, then
`npx tsc --noEmit`.
Expected: migration applied; `status_incidents` present in the types; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0079_status_page.sql lib/types/database.ts
git commit -m "feat(status): incidents, updates, subscriptions + RLS"
```

---

### Task 3: View layer

**Files:**
- Create: `lib/views/status.ts`

**Interfaces:**
- Consumes: Task 1 (`worstType`), Task 2 tables.
- Produces:
  - `type StatusUpdate = { id: string; body: string; isResolution: boolean; createdAt: string; author: string | null }`
  - `type StatusIncident = { id: string; title: string; type: string; status: string; scope: string; startedAt: string; resolvedAt: string | null; clientNames: string[]; updates: StatusUpdate[] }`
  - `getStatusPage(): Promise<{ active: StatusIncident[]; history: StatusIncident[]; subscribed: boolean }>`
  - `getStatusIndicator(): Promise<string | null>` — worst active visible type, or null

- [ ] **Step 1: Write the view layer**

`lib/views/status.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { worstType, typeRank } from "@/lib/status-helpers";

export type StatusUpdate = {
  id: string;
  body: string;
  isResolution: boolean;
  createdAt: string;
  author: string | null;
};

export type StatusIncident = {
  id: string;
  title: string;
  type: string;
  status: string;
  scope: string;
  startedAt: string;
  resolvedAt: string | null;
  /** Staff only — clients never see which OTHER clients are affected. */
  clientNames: string[];
  updates: StatusUpdate[];
};

const HISTORY_CAP = 50;

/** Everything the /status page needs. RLS scopes every query: staff see all,
 *  a client sees global incidents plus their own. */
export async function getStatusPage(): Promise<{
  active: StatusIncident[];
  history: StatusIncident[];
  subscribed: boolean;
}> {
  const supabase = await createClient();
  const me = await getCurrentProfile();
  const isStaff = me.authenticated && me.profile.role === "rocking_staff";

  const [{ data: incidents }, { data: updates }, { data: targets }, { data: clients }, { data: subs }, { data: profiles }] =
    await Promise.all([
      supabase
        .from("status_incidents")
        .select("id, title, type, status, scope, started_at, resolved_at")
        .order("started_at", { ascending: false })
        .limit(HISTORY_CAP + 50),
      supabase
        .from("status_updates")
        .select("id, incident_id, body, is_resolution, created_at, created_by")
        .order("created_at", { ascending: false }),
      isStaff
        ? supabase.from("status_incident_clients").select("incident_id, client_id")
        : Promise.resolve({ data: [] as { incident_id: string; client_id: string }[] }),
      isStaff
        ? supabase.from("clients").select("id, name")
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      me.authenticated
        ? supabase.from("status_subscriptions").select("profile_id").eq("profile_id", me.profile.id)
        : Promise.resolve({ data: [] as { profile_id: string }[] }),
      supabase.from("profiles").select("id, email"),
    ]);

  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const author = (id: string | null) => {
    const e = id ? emailById.get(id) : null;
    return e ? e.split("@")[0].replace(/[._]/g, " ") : null;
  };
  const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const namesByIncident = new Map<string, string[]>();
  for (const t of targets ?? []) {
    const list = namesByIncident.get(t.incident_id) ?? [];
    list.push(clientName.get(t.client_id) ?? "—");
    namesByIncident.set(t.incident_id, list);
  }
  const updatesByIncident = new Map<string, StatusUpdate[]>();
  for (const u of updates ?? []) {
    const list = updatesByIncident.get(u.incident_id) ?? [];
    list.push({
      id: u.id,
      body: u.body,
      isResolution: u.is_resolution,
      createdAt: u.created_at,
      author: author(u.created_by),
    });
    updatesByIncident.set(u.incident_id, list);
  }

  const all: StatusIncident[] = (incidents ?? []).map((i) => ({
    id: i.id,
    title: i.title,
    type: i.type,
    status: i.status,
    scope: i.scope,
    startedAt: i.started_at,
    resolvedAt: i.resolved_at,
    clientNames: (namesByIncident.get(i.id) ?? []).sort(),
    updates: updatesByIncident.get(i.id) ?? [],
  }));

  const active = all
    .filter((i) => i.status === "active")
    .sort((a, b) => typeRank(a.type) - typeRank(b.type) || b.startedAt.localeCompare(a.startedAt));
  const history = all.filter((i) => i.status === "resolved").slice(0, HISTORY_CAP);

  return { active, history, subscribed: (subs ?? []).length > 0 };
}

/** Worst active incident type visible to the caller — drives the top-bar dot.
 *  Never throws: the shell must render even if this query fails. */
export async function getStatusIndicator(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("status_incidents").select("type").eq("status", "active");
    return worstType((data ?? []).map((i) => i.type));
  } catch (e) {
    console.error("status indicator failed:", e);
    return null;
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Commit**

```bash
git add lib/views/status.ts
git commit -m "feat(status): view layer for the status page and indicator"
```

---

### Task 4: Actions + email

**Files:**
- Create: `lib/status-email.ts`
- Create: `lib/actions/status.ts`

**Interfaces:**
- Consumes: Task 1 (`resolveRecipients`, `subjectFor`, `TYPE_LABELS`, `type Subscriber`); `sendEmail` from `@/lib/email/send`.
- Produces: `notifyIncident(incidentId, updateBody, opts)` and the four actions `postIncident`, `postUpdate`, `resolveIncident`, `setStatusSubscription`.

- [ ] **Step 1: Write the mailer**

`lib/status-email.ts`:

```ts
// Status emails. One message PER RECIPIENT — never a shared `to:` array,
// which would leak client addresses to each other and misfile the
// sent_emails record (it carries a single client_id).
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { resolveRecipients, subjectFor, TYPE_LABELS, type Subscriber } from "@/lib/status-helpers";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";
const SUPPORT_EMAIL = "support@rocking.co.za";

function html(title: string, type: string, body: string, resolved: boolean): string {
  const heading = resolved ? "Resolved" : TYPE_LABELS[type] ?? "Update";
  const tint = resolved ? "#15803D" : type === "outage" ? "#B91C1C" : type === "degraded" ? "#B45309" : "#185FA5";
  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1a1a;">
  <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:${tint};text-transform:uppercase;letter-spacing:.4px;">${heading}</p>
  <h2 style="margin:0 0 14px;font-size:19px;">${title}</h2>
  <p style="margin:0 0 18px;white-space:pre-wrap;color:#333;font-size:14px;line-height:1.5;">${body}</p>
  <a href="${APP_URL}/status" style="display:inline-block;background:#D7141C;color:#fff;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:8px;font-size:14px;">View status page</a>
  <p style="color:#888;margin:18px 0 0;font-size:12px;">You're receiving this because you turned on status updates. You can turn them off on the status page.</p>
</div>`;
}

/** Emails everyone subscribed who can see this incident. Best-effort: a send
 *  failure is logged, never thrown — communicating during an outage must not
 *  depend on the mailer being healthy. */
export async function notifyIncident(
  incidentId: string,
  updateBody: string,
  opts: { resolved?: boolean } = {},
): Promise<{ sent: number; failed: number }> {
  const service = createServiceClient();
  const counts = { sent: 0, failed: 0 };
  try {
    const [{ data: incident }, { data: targets }, { data: subRows }] = await Promise.all([
      service.from("status_incidents").select("title, type, scope").eq("id", incidentId).maybeSingle(),
      service.from("status_incident_clients").select("client_id").eq("incident_id", incidentId),
      service.from("status_subscriptions").select("profile_id"),
    ]);
    if (!incident) return counts;

    const ids = (subRows ?? []).map((s) => s.profile_id);
    if (ids.length === 0) return counts;
    const { data: profiles } = await service
      .from("profiles")
      .select("id, email, client_id, role")
      .in("id", ids);

    const subs: Subscriber[] = (profiles ?? []).map((p) => ({
      profileId: p.id,
      email: p.email,
      clientId: p.client_id,
      role: p.role,
    }));
    const recipients = resolveRecipients(subs, {
      scope: incident.scope,
      clientIds: (targets ?? []).map((t) => t.client_id),
    });

    const subject = subjectFor(incident.title, incident.type, !!opts.resolved);
    const body = html(incident.title, incident.type, updateBody, !!opts.resolved);
    for (const r of recipients) {
      try {
        await sendEmail({
          to: [r.email],
          subject,
          html: body,
          replyTo: SUPPORT_EMAIL,
          clientId: r.clientId,
          category: "status",
        });
        counts.sent++;
      } catch (e) {
        counts.failed++;
        console.error(`status email to ${r.email} failed:`, e);
      }
    }
  } catch (e) {
    console.error("status notification failed:", e);
  }
  return counts;
}
```

- [ ] **Step 2: Write the actions**

`lib/actions/status.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import { notifyIncident } from "@/lib/status-email";
import { INCIDENT_TYPES } from "@/lib/status-helpers";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

/** Posts an incident AND its first update in one go — an incident is never a
 *  headline with no story. Emails go out after the write succeeds. */
export async function postIncident(formData: FormData) {
  const me = await staff();
  const title = String(formData.get("title") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const scope = String(formData.get("scope") ?? "global");
  const body = String(formData.get("body") ?? "").trim();
  if (!title || !body) throw new Error("A title and a first update are both required");
  if (!(INCIDENT_TYPES as readonly string[]).includes(type)) throw new Error("invalid type");
  if (scope !== "global" && scope !== "clients") throw new Error("invalid scope");
  const clientIds = formData.getAll("client_ids").map(String).filter(Boolean);
  if (scope === "clients" && clientIds.length === 0) {
    throw new Error("Pick at least one client, or post it as global");
  }

  const supabase = await createClient();
  const { data: incident, error } = await supabase
    .from("status_incidents")
    .insert({ title, type, scope, created_by: me.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  if (scope === "clients") {
    const { error: tErr } = await supabase
      .from("status_incident_clients")
      .insert(clientIds.map((client_id) => ({ incident_id: incident.id, client_id })));
    if (tErr) throw new Error(tErr.message);
  }
  const { error: uErr } = await supabase
    .from("status_updates")
    .insert({ incident_id: incident.id, body, created_by: me.id });
  if (uErr) throw new Error(uErr.message);

  await notifyIncident(incident.id, body);
  revalidatePath("/status");
}

export async function postUpdate(incidentId: string, formData: FormData) {
  const me = await staff();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error("Write an update first");
  const supabase = await createClient();
  const { error } = await supabase
    .from("status_updates")
    .insert({ incident_id: incidentId, body, created_by: me.id });
  if (error) throw new Error(error.message);
  await notifyIncident(incidentId, body);
  revalidatePath("/status");
}

/** Resolution is an update too — with the flag set and the incident closed. */
export async function resolveIncident(incidentId: string, formData: FormData) {
  const me = await staff();
  const body = String(formData.get("body") ?? "").trim() || "This incident has been resolved.";
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("status_incidents")
    .update({ status: "resolved", resolved_at: now, updated_at: now })
    .eq("id", incidentId);
  if (error) throw new Error(error.message);
  const { error: uErr } = await supabase
    .from("status_updates")
    .insert({ incident_id: incidentId, body, is_resolution: true, created_by: me.id });
  if (uErr) throw new Error(uErr.message);
  await notifyIncident(incidentId, body, { resolved: true });
  revalidatePath("/status");
}

/** A user's own opt-in. Row present = subscribed. RLS restricts this to the
 *  caller's own row, so no ownership check is needed here. */
export async function setStatusSubscription(subscribe: boolean) {
  const me = await getCurrentProfile();
  if (!me.authenticated) throw new Error("sign in first");
  const supabase = await createClient();
  if (subscribe) {
    const { error } = await supabase
      .from("status_subscriptions")
      .upsert({ profile_id: me.profile.id }, { onConflict: "profile_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from("status_subscriptions").delete().eq("profile_id", me.profile.id);
    if (error) throw new Error(error.message);
  }
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add lib/status-email.ts lib/actions/status.ts
git commit -m "feat(status): post/update/resolve actions + per-recipient email"
```

---

### Task 5: The `/status` page

**Files:**
- Create: `app/(app)/status/page.tsx` (server)
- Create: `app/(app)/status/SubscribeToggle.tsx` (client)
- Create: `app/(app)/status/StaffControls.tsx` (client — post form + per-incident controls)

**Interfaces:**
- Consumes: Task 3 (`getStatusPage`), Task 4 actions, Task 1 (`TYPE_LABELS`, `dotColour`, `statusLabel`, `INCIDENT_TYPES`).

Note the route lives under `(app)` so both clients and staff can reach `/status`
— the `(app)` layout redirects staff to `/admin`, so the page must be reachable
without that redirect. Put it under `(app)` and confirm during the build that a
staff session can load `/status`; if the layout redirects, move the route to the
root (`app/status/page.tsx`) and render it inside its own minimal shell.

- [ ] **Step 1: Subscribe toggle**

`app/(app)/status/SubscribeToggle.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { setStatusSubscription } from "@/lib/actions/status";

/** Opt in/out of status emails. Updates locally on success so the preference
 *  never costs the reader their place on the page. */
export function SubscribeToggle({ initial }: { initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = () => {
    const next = !on;
    setErr(null);
    start(async () => {
      try {
        await setStatusSubscription(next);
        setOn(next);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not save that");
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
          on ? "bg-ink text-white hover:bg-black" : "border border-line text-ink-2 hover:bg-line-soft"
        }`}
      >
        {pending ? "Saving…" : on ? "Emailing you updates ✓" : "Email me updates"}
      </button>
      <span className="text-[12.5px] text-muted">
        {on ? "You'll get an email for every new incident and update." : "Get an email whenever something changes."}
      </span>
      {err && <span className="text-[12.5px] font-medium text-brand">{err}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Staff controls**

`app/(app)/status/StaffControls.tsx`: a client component exporting two pieces.

```tsx
"use client";

import { useState, useTransition } from "react";
import { postIncident, postUpdate, resolveIncident } from "@/lib/actions/status";
import { INCIDENT_TYPES, TYPE_LABELS } from "@/lib/status-helpers";

const FIELD =
  "rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-faint";

/** Post a new incident. Scope 'clients' reveals the client picker. */
export function PostIncidentForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [scope, setScope] = useState("global");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (fd: FormData) => {
    setErr(null);
    start(async () => {
      try {
        await postIncident(fd);
        setOpen(false);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not post that");
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white hover:bg-brand-dark"
      >
        + Post incident
      </button>
    );
  }

  return (
    <form action={submit} className="space-y-3 rounded-xl border border-line bg-card p-4">
      <input name="title" required placeholder="What's wrong? e.g. Fibre down at GSR Law" className={`${FIELD} w-full`} />
      <div className="flex flex-wrap items-center gap-2">
        <select name="type" defaultValue="outage" className={FIELD}>
          {INCIDENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} className={FIELD}>
          <option value="global">Everyone</option>
          <option value="clients">Specific clients</option>
        </select>
      </div>
      {scope === "clients" && (
        <select name="client_ids" multiple size={8} className={`${FIELD} w-full`}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <textarea
        name="body"
        required
        rows={3}
        placeholder="First update — what's happening and what you're doing about it."
        className={`${FIELD} w-full`}
      />
      <div className="flex items-center gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-60"
        >
          {pending ? "Posting…" : "Post"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-[13px] font-semibold text-muted hover:text-ink">
          Cancel
        </button>
        {err && <span className="text-[12.5px] font-medium text-brand">{err}</span>}
      </div>
    </form>
  );
}

/** Post an update to, or resolve, one active incident. */
export function IncidentControls({ incidentId }: { incidentId: string }) {
  const [mode, setMode] = useState<null | "update" | "resolve">(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (fd: FormData) => {
    setErr(null);
    const action = mode === "resolve" ? resolveIncident : postUpdate;
    start(async () => {
      try {
        await action(incidentId, fd);
        setMode(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not save that");
      }
    });
  };

  if (!mode) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("update")}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-line-soft"
        >
          Post update
        </button>
        <button
          type="button"
          onClick={() => setMode("resolve")}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-line-soft"
        >
          Resolve
        </button>
      </div>
    );
  }

  return (
    <form action={submit} className="w-full space-y-2">
      <textarea
        name="body"
        rows={2}
        required={mode === "update"}
        placeholder={mode === "resolve" ? "How it was resolved (optional)" : "What's changed?"}
        className={`${FIELD} w-full`}
      />
      <div className="flex items-center gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-black disabled:opacity-60"
        >
          {pending ? "Saving…" : mode === "resolve" ? "Resolve incident" : "Post update"}
        </button>
        <button type="button" onClick={() => setMode(null)} className="text-[12.5px] font-semibold text-muted hover:text-ink">
          Cancel
        </button>
        {err && <span className="text-[12.5px] font-medium text-brand">{err}</span>}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: The page**

`app/(app)/status/page.tsx`: server component.

- Guard: `getCurrentProfile()`; redirect `/login` when unauthenticated.
- `const { active, history, subscribed } = await getStatusPage();`
- Staff also fetch the client list for the picker: `supabase.from("clients").select("id, name").eq("status","active").order("name")`.
- Header: `PageHeader` titled "Status", subtitle `statusLabel(worstType(active.map(i => i.type)))`, with `<PostIncidentForm clients={…} />` as the action for staff.
- **Current state Card:** when `active.length === 0`, a green dot + "All systems operational". Otherwise one block per active incident: coloured dot (`dotColour(i.type)`), `TYPE_LABELS[i.type]` pill, title, "since {startedAt}", scope line — for staff `i.scope === "global" ? "All clients" : i.clientNames.join(", ")`, for clients `i.scope === "global" ? "All clients" : "Your account"` — then its `updates` newest-first (body, author, timestamp), then `<IncidentControls incidentId={i.id} />` for staff.
- **Subscribe:** `<SubscribeToggle initial={subscribed} />` for non-staff, below the current state.
- **History Card:** titled "History", `count={history.length}`, each resolved incident as a row: type pill, title, started → resolved dates, and its updates in a `<details>` so the page stays scannable. Empty state: "Nothing here yet — no incidents have been recorded."
- Timestamps format as `ts.replace("T"," ").slice(0,16)` (matches the rest of the app).

- [ ] **Step 4: Build**

Run: `npm run build` → compiles; `/status` in the route list.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/status"
git commit -m "feat(status): status page with staff controls and email opt-in"
```

---

### Task 6: Top-bar indicator + verification + push

**Files:**
- Modify: `components/AppShell.tsx` (accept `statusType`, render the dot + link)
- Modify: `app/(app)/layout.tsx` and `app/(admin)/layout.tsx` (compute and pass it)

- [ ] **Step 1: AppShell**

Add to the props type: `/** Worst active incident type visible to this viewer; null = all clear. */ statusType?: string | null;` and destructure it. Import `dotColour` from `@/lib/status-helpers` and `Link` (already imported). In the top bar, immediately before the `Support` link:

```tsx
              <Link
                href="/status"
                className="flex items-center gap-1.5 text-[13.5px] font-medium text-ink-3 hover:text-ink"
              >
                <span
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{ background: dotColour(statusType ?? null) }}
                />
                Status
              </Link>
```

- [ ] **Step 2: Both layouts**

In each of `app/(app)/layout.tsx` and `app/(admin)/layout.tsx`: `import { getStatusIndicator } from "@/lib/views/status";`, call `const statusType = await getStatusIndicator();` alongside the existing data fetches, and pass `statusType={statusType}` to `<AppShell>`.

- [ ] **Step 3: Build + full suite**

Run: `npm test && npm run build` → suite green, build clean.

- [ ] **Step 4: Live verification** (service-role script + a real client JWT, same idiom as previous features)

1. Post a **client-scoped** incident targeting JoosteCo (type `outage`) via the DB or the UI.
2. `getStatusIndicator` equivalent for a JoosteCo user → `outage`; for a different client → `null`. Verify with two real user JWTs querying `status_incidents` where `status='active'`: JoosteCo sees 1 row, the other client sees 0.
3. Confirm `status_updates` for that incident returns 0 rows for the unaffected client (RLS on the child table).
4. Subscribe a JoosteCo user, post an update, confirm exactly one `sent_emails` row with `category='status'` and that client's `client_id` — and none for the unaffected client's subscriber.
5. Resolve it; confirm `resolved_at` set, the incident leaves `active`, a resolution update exists with `is_resolution = true`, and a `[Resolved]` email was recorded.
6. Post a **global** incident; confirm both clients now see it.
7. Delete the test incidents (cascade removes updates/targets) and the test subscription.

- [ ] **Step 5: Push**

```bash
git add components/AppShell.tsx "app/(app)/layout.tsx" "app/(admin)/layout.tsx"
git commit -m "feat(status): top-bar status indicator"
git push origin main
```

Then health-check `/status` after deploy (307 → login when unauthenticated).
