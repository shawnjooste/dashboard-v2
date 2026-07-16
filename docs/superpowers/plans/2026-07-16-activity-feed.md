# Admin Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-only `/admin/activity` timeline of client logins, deduped section visits, portal actions, domain events, and sync runs.

**Architecture:** One new `portal_activity` table captures visits (hour-deduped via a generated `hour_bucket` column + unique index), derived logins (8-hour gap rule), and explicit actions — written via the service client from a fire-and-forget `after()` hook in the client layout. The feed merges that table with six existing event tables at read time in `lib/views/activity.ts` and renders a day-grouped, filterable timeline.

**Tech Stack:** Next.js 16 (middleware request headers, `after()` from next/server), Supabase Postgres/RLS, vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-activity-feed-design.md`

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs` (verify `cat supabase/.temp/project-ref` before push); never `qomxwxxulxcwnpaqzudl`.
- All commands from `/Users/shawnjooste/Documents/Claude/dashboard-v2`.
- Pure helpers in an import-free file (vitest-safe convention).
- `portal_activity`: staff-only select; NO client policies; all writes via service client.
- Staff browsing never tracked; client users only. Tracking failures are swallowed — never break a page.
- Visit dedupe: max one row per profile+kind+section+hour.
- Feed defaults to last 7 days; source queries capped at 500 rows each with a visible "showing most recent" note when hit.
- Design tokens/components per repo (`Card`, `CardHeader`, `PageHeader`, chips styled like existing pills).
- Quote parenthesized paths in shell. Stale `.git/index.lock` → remove and retry (Cursor git worker).

---

### Task 1: Pure helpers + tests (TDD)

**Files:**
- Create: `lib/activity-helpers.ts`
- Test: `lib/activity-helpers.test.ts`

**Interfaces:**
- Produces: `sectionFromPath(pathname: string): string`; `SECTION_LABELS: Record<string, string>`; `isLoginGap(minutesSinceLast: number | null): boolean`; `groupByDay<T extends { at: string }>(items: T[]): { day: string; items: T[] }[]` (items assumed sorted desc; day = YYYY-MM-DD of `at`).

- [ ] **Step 1: Write the failing test**

`lib/activity-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupByDay, isLoginGap, sectionFromPath } from "./activity-helpers";

describe("sectionFromPath", () => {
  it("maps the account home", () => {
    expect(sectionFromPath("/")).toBe("home");
  });
  it("maps list pages to their section", () => {
    expect(sectionFromPath("/billing")).toBe("billing");
    expect(sectionFromPath("/quotes")).toBe("quotes");
    expect(sectionFromPath("/support")).toBe("support");
  });
  it("maps a device detail page to 'device'", () => {
    expect(sectionFromPath("/devices/abc-123")).toBe("device");
  });
  it("keeps quote detail under 'quotes'", () => {
    expect(sectionFromPath("/quotes/abc-123")).toBe("quotes");
  });
  it("maps unknown paths to 'other'", () => {
    expect(sectionFromPath("/welcome")).toBe("other");
  });
});

describe("isLoginGap", () => {
  it("no prior activity is a login", () => {
    expect(isLoginGap(null)).toBe(true);
  });
  it("eight hours or more is a login", () => {
    expect(isLoginGap(480)).toBe(true);
  });
  it("recent activity is not a login", () => {
    expect(isLoginGap(90)).toBe(false);
  });
});

describe("groupByDay", () => {
  it("groups sorted items by calendar day", () => {
    const items = [
      { at: "2026-07-16T09:00:00Z", n: 1 },
      { at: "2026-07-16T07:00:00Z", n: 2 },
      { at: "2026-07-15T22:00:00Z", n: 3 },
    ];
    const groups = groupByDay(items);
    expect(groups.map((g) => g.day)).toEqual(["2026-07-16", "2026-07-15"]);
    expect(groups[0].items).toHaveLength(2);
  });
  it("handles empty input", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/activity-helpers.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

`lib/activity-helpers.ts`:

```ts
/** Pure activity-feed logic — no server imports (vitest-safe). */

export const SECTION_LABELS: Record<string, string> = {
  home: "Account home",
  devices: "Devices",
  device: "a device",
  billing: "Billing",
  quotes: "Quotes",
  support: "Support",
  m365: "Microsoft 365",
  network: "Network",
  team: "Team",
  work: "Work",
  other: "the portal",
};

const SECTIONS = new Set(["devices", "billing", "quotes", "support", "m365", "network", "team", "work"]);

/** Client-surface pathname → section key for visit tracking. */
export function sectionFromPath(pathname: string): string {
  const [seg0, seg1] = pathname.replace(/^\/+/, "").split("/");
  if (!seg0) return "home";
  if (seg0 === "devices" && seg1) return "device";
  return SECTIONS.has(seg0) ? seg0 : "other";
}

/** A visit after >= 8 quiet hours (or no history) counts as a sign-in. */
export function isLoginGap(minutesSinceLast: number | null): boolean {
  return minutesSinceLast === null || minutesSinceLast >= 480;
}

/** Group desc-sorted items into day buckets (UTC calendar days). */
export function groupByDay<T extends { at: string }>(items: T[]): { day: string; items: T[] }[] {
  const groups: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = item.at.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}
```

- [ ] **Step 4: Verify pass**

Run: `npx vitest run lib/activity-helpers.test.ts` → 10 pass; `npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add lib/activity-helpers.ts lib/activity-helpers.test.ts
git commit -m "feat(activity): pure section/login-gap/day-grouping helpers"
```

---

### Task 2: Migration — portal_activity

**Files:**
- Create: `supabase/migrations/0045_portal_activity.sql`
- Modify: `lib/types/database.ts` (regenerated)

**Interfaces:**
- Produces: table `public.portal_activity` (columns below) with hour-dedupe unique index. Tasks 3–4 write/read it.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0045_portal_activity.sql`:

```sql
-- Engagement capture for the admin activity feed: section visits (deduped to
-- one row per user+section+hour), derived logins, and explicit portal actions.
-- Client users only — staff browsing is never tracked. Writes happen strictly
-- server-side via the service client; there are NO client RLS policies.
create table public.portal_activity (
  id          uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  profile_id  uuid references public.profiles(id) on delete set null,
  client_id   uuid references public.clients(id) on delete cascade,
  kind        text not null check (kind in ('visit','login','action')),
  section     text not null,
  detail      text,
  hour_bucket timestamptz not null generated always as (date_trunc('hour', occurred_at)) stored
);

-- The dedupe: repeat visits inside an hour become ON CONFLICT DO NOTHING.
create unique index portal_activity_dedupe_idx
  on public.portal_activity (profile_id, kind, section, hour_bucket);
create index portal_activity_at_idx on public.portal_activity (occurred_at desc);

alter table public.portal_activity enable row level security;
create policy portal_activity_staff_read on public.portal_activity
  for select using (public.is_rocking_staff());
```

- [ ] **Step 2: Push (verify ref)**

`cat supabase/.temp/project-ref` → `eskhokedsximnslgsycs`, then `npx supabase db push --linked` → "Applying migration 0045… Finished".

- [ ] **Step 3: Types + typecheck**

`npx supabase gen types typescript --linked > lib/types/database.ts && npx tsc --noEmit` → clean, `portal_activity` present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0045_portal_activity.sql lib/types/database.ts
git commit -m "feat(activity): portal_activity table with hour-dedupe index"
```

---

### Task 3: Capture — middleware header, track helpers, layout hook, ticket action

**Files:**
- Modify: `middleware.ts` (forward `x-pathname`)
- Create: `lib/track.ts`
- Modify: `app/(app)/layout.tsx` (call the hook via `after()`)
- Modify: `app/(app)/support/actions.ts` (track `ticket_created`)

**Interfaces:**
- Consumes: `sectionFromPath`, `isLoginGap` (Task 1); `portal_activity` (Task 2); `getCurrentProfile`'s profile shape `{ id, role, client_id }`.
- Produces: `trackVisit(profile: { id: string; role: string; client_id: string | null }, pathname: string): Promise<void>` and `trackAction(profile: …, section: string, detail?: string): Promise<void>` — both swallow errors.

- [ ] **Step 1: Forward the pathname in middleware**

`middleware.ts` — mutate the request headers before the session handler (it already forwards the request):

```ts
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Server layouts can't see the URL; forward it for visit tracking.
  request.headers.set("x-pathname", request.nextUrl.pathname);
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 2: Write the track helpers**

`lib/track.ts`:

```ts
import { createServiceClient } from "@/lib/supabase/service";
import { isLoginGap, sectionFromPath } from "@/lib/activity-helpers";

type TrackableProfile = { id: string; role: string; client_id: string | null };

/** Record a section visit (deduped per hour by the DB) and derive a login
 *  event after >= 8 quiet hours. Client users only; failures are swallowed —
 *  tracking must never break or slow a page. */
export async function trackVisit(profile: TrackableProfile, pathname: string): Promise<void> {
  try {
    if (profile.role === "rocking_staff" || !profile.client_id) return;
    const section = sectionFromPath(pathname);
    const service = createServiceClient();
    const { data: inserted } = await service
      .from("portal_activity")
      .upsert(
        { profile_id: profile.id, client_id: profile.client_id, kind: "visit", section },
        { onConflict: "profile_id,kind,section,hour_bucket", ignoreDuplicates: true },
      )
      .select("id");
    // Only a genuinely new visit row can be the first sign of a session.
    if (!inserted?.length) return;
    const { data: prior } = await service
      .from("portal_activity")
      .select("occurred_at")
      .eq("profile_id", profile.id)
      .neq("id", inserted[0].id)
      .order("occurred_at", { ascending: false })
      .limit(1);
    const minutes = prior?.length
      ? Math.round((Date.now() - new Date(prior[0].occurred_at).getTime()) / 60000)
      : null;
    if (isLoginGap(minutes)) {
      await service
        .from("portal_activity")
        .upsert(
          { profile_id: profile.id, client_id: profile.client_id, kind: "login", section: "session" },
          { onConflict: "profile_id,kind,section,hour_bucket", ignoreDuplicates: true },
        );
    }
  } catch (e) {
    console.error("trackVisit failed:", e);
  }
}

/** Record an explicit portal action, e.g. ("ticket_created", subject). */
export async function trackAction(profile: TrackableProfile, section: string, detail?: string): Promise<void> {
  try {
    if (profile.role === "rocking_staff" || !profile.client_id) return;
    await createServiceClient().from("portal_activity").insert({
      profile_id: profile.id,
      client_id: profile.client_id,
      kind: "action",
      section,
      detail: detail?.slice(0, 200) ?? null,
    });
  } catch (e) {
    console.error("trackAction failed:", e);
  }
}
```

- [ ] **Step 3: Hook the client layout**

In `app/(app)/layout.tsx`, add imports:

```ts
import { headers } from "next/headers";
import { after } from "next/server";
import { trackVisit } from "@/lib/track";
```

and directly after the `me.profile.role === "rocking_staff"` redirect line:

```ts
  const pathname = (await headers()).get("x-pathname") ?? "/";
  const trackable = { id: me.profile.id, role: me.profile.role, client_id: me.profile.client_id };
  // Post-response so tracking adds zero latency to the page.
  after(() => trackVisit(trackable, pathname));
```

- [ ] **Step 4: Track portal ticket creation**

In `app/(app)/support/actions.ts` `createTicketAction`, right before the `redirect(...)` at the end (the `me` profile is already fetched there for tier tags):

```ts
  if (me.authenticated) {
    const { trackAction } = await import("@/lib/track");
    await trackAction(
      { id: me.profile.id, role: me.profile.role, client_id: me.profile.client_id },
      "ticket_created",
      subject,
    );
  }
```

- [ ] **Step 5: Typecheck + build**

`npx tsc --noEmit && npm run build` → clean.

- [ ] **Step 6: Commit**

```bash
git add middleware.ts lib/track.ts "app/(app)/layout.tsx" "app/(app)/support/actions.ts"
git commit -m "feat(activity): visit/login/action capture via after() hook"
```

---

### Task 4: Feed — view layer, page, nav

**Files:**
- Create: `lib/views/activity.ts`
- Create: `app/(admin)/admin/activity/page.tsx`
- Modify: `lib/nav.ts` (Clients group: `{ label: "Activity", href: "/admin/activity" }` after Users)

**Interfaces:**
- Consumes: Task 1 helpers, Task 2 table, existing tables (`quote_events`+`quotes`, `rfq_events`+`rfqs`, `device_changes`+`devices`, `support_time_entries`, `import_runs`, `impersonation_log`, `profiles`, `clients`).
- Produces: `type ActivityItem = { at: string; group: ActivityGroup; actor: string | null; clientId: string | null; clientName: string | null; text: string; href?: string }`; `type ActivityGroup = "logins" | "views" | "actions" | "changes" | "quotes" | "syncs"`; `getActivity(days: number): Promise<{ items: ActivityItem[]; capped: boolean }>`.

- [ ] **Step 1: Write the view layer**

`lib/views/activity.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { SECTION_LABELS } from "@/lib/activity-helpers";

export type ActivityGroup = "logins" | "views" | "actions" | "changes" | "quotes" | "syncs";

export type ActivityItem = {
  at: string;
  group: ActivityGroup;
  actor: string | null;
  clientId: string | null;
  clientName: string | null;
  text: string;
  href?: string;
};

const CAP = 500;

/** Everything that happened across the portal in the last `days` days,
 *  merged newest-first from portal_activity + the domain event tables.
 *  Staff-only by construction: every query runs under the caller's RLS. */
export async function getActivity(days: number): Promise<{ items: ActivityItem[]; capped: boolean }> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [activity, quoteEvents, quotes, rfqEvents, rfqs, changes, devices, time, imports, imp, profiles, clients] =
    await Promise.all([
      supabase.from("portal_activity").select("occurred_at, profile_id, client_id, kind, section, detail").gte("occurred_at", since).order("occurred_at", { ascending: false }).limit(CAP),
      supabase.from("quote_events").select("created_at, quote_id, event, actor_profile_id").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
      supabase.from("quotes").select("id, quote_number, client_id"),
      supabase.from("rfq_events").select("created_at, rfq_id, kind, body, posted_by_profile_id").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
      supabase.from("rfqs").select("id, title, client_id"),
      supabase.from("device_changes").select("created_at, device_id, category, note, created_by_profile_id").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
      supabase.from("devices").select("id, hostname, client_id"),
      supabase.from("support_time_entries").select("created_at, client_id, minutes, work_type, note, entered_by").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
      supabase.from("import_runs").select("created_at, source, counts").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
      supabase.from("impersonation_log").select("started_at, staff_profile_id, target_email").gte("started_at", since).order("started_at", { ascending: false }).limit(CAP),
      supabase.from("profiles").select("id, email"),
      supabase.from("clients").select("id, name"),
    ]);

  const email = new Map((profiles.data ?? []).map((p) => [p.id, p.email]));
  const person = (id: string | null) => {
    const e = id ? email.get(id) : null;
    return e ? e.split("@")[0].replace(/[._]/g, " ") : null;
  };
  const clientName = new Map((clients.data ?? []).map((c) => [c.id, c.name]));
  const quoteById = new Map((quotes.data ?? []).map((q) => [q.id, q]));
  const rfqById = new Map((rfqs.data ?? []).map((r) => [r.id, r]));
  const deviceById = new Map((devices.data ?? []).map((d) => [d.id, d]));

  const items: ActivityItem[] = [];
  const push = (i: ActivityItem) => items.push(i);
  const named = (clientId: string | null) => (clientId ? (clientName.get(clientId) ?? null) : null);

  for (const a of activity.data ?? []) {
    const base = { at: a.occurred_at, actor: person(a.profile_id), clientId: a.client_id, clientName: named(a.client_id) };
    if (a.kind === "login") push({ ...base, group: "logins", text: "signed in" });
    else if (a.kind === "visit") push({ ...base, group: "views", text: `viewed ${SECTION_LABELS[a.section] ?? a.section}` });
    else if (a.section === "ticket_created") push({ ...base, group: "actions", text: `raised a ticket${a.detail ? `: “${a.detail}”` : ""}` });
    else push({ ...base, group: "actions", text: `${a.section}${a.detail ? ` — ${a.detail}` : ""}` });
  }
  for (const e of quoteEvents.data ?? []) {
    const q = quoteById.get(e.quote_id);
    push({
      at: e.created_at, group: "quotes", actor: person(e.actor_profile_id),
      clientId: q?.client_id ?? null, clientName: named(q?.client_id ?? null),
      text: `quote ${q?.quote_number ?? "?"} ${e.event.replace("_", " ")}`,
      href: `/admin/quotes/${e.quote_id}`,
    });
  }
  for (const e of rfqEvents.data ?? []) {
    const r = rfqById.get(e.rfq_id);
    push({
      at: e.created_at, group: "changes", actor: person(e.posted_by_profile_id),
      clientId: r?.client_id ?? null, clientName: named(r?.client_id ?? null),
      text: `RFQ “${r?.title ?? "?"}” — ${e.kind}${e.body ? `: ${e.body}` : ""}`,
      href: `/admin/rfqs/${e.rfq_id}`,
    });
  }
  for (const c of changes.data ?? []) {
    const d = deviceById.get(c.device_id);
    push({
      at: c.created_at, group: "changes", actor: person(c.created_by_profile_id),
      clientId: d?.client_id ?? null, clientName: named(d?.client_id ?? null),
      text: `logged ${c.category} change on ${d?.hostname ?? "a device"}: ${c.note.slice(0, 80)}`,
      href: `/admin/devices/${c.device_id}`,
    });
  }
  for (const t of time.data ?? []) {
    push({
      at: t.created_at, group: "changes", actor: person(t.entered_by),
      clientId: t.client_id, clientName: named(t.client_id),
      text: `logged ${t.minutes}m ${t.work_type} support${t.note ? `: ${t.note.slice(0, 60)}` : ""}`,
    });
  }
  for (const r of imports.data ?? []) {
    const counts = Object.entries((r.counts as Record<string, unknown>) ?? {})
      .filter(([, v]) => typeof v === "number" && v > 0)
      .slice(0, 3)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    push({ at: r.created_at, group: "syncs", actor: null, clientId: null, clientName: null, text: `${r.source} sync${counts ? ` — ${counts}` : ""}` });
  }
  for (const i of imp.data ?? []) {
    push({ at: i.started_at, group: "actions", actor: person(i.staff_profile_id), clientId: null, clientName: null, text: `viewed the portal as ${i.target_email}` });
  }

  items.sort((a, b) => b.at.localeCompare(a.at));
  const capped = [activity, quoteEvents, rfqEvents, changes, time, imports, imp].some((r) => (r.data?.length ?? 0) === CAP);
  return { items, capped };
}
```

- [ ] **Step 2: Write the page**

`app/(admin)/admin/activity/page.tsx`:

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getActivity, type ActivityGroup } from "@/lib/views/activity";
import { groupByDay } from "@/lib/activity-helpers";
import { Card, CardHeader, PageHeader } from "@/components/ui";

const GROUPS: { key: ActivityGroup | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "logins", label: "Logins" },
  { key: "views", label: "Views" },
  { key: "actions", label: "Actions" },
  { key: "changes", label: "Changes" },
  { key: "quotes", label: "Quotes" },
  { key: "syncs", label: "Syncs" },
];
const DAY_OPTIONS = [1, 7, 30];
const fmtTime = (ts: string) => ts.slice(11, 16);

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; days?: string; client?: string }>;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const params = await searchParams;
  const group = (GROUPS.some((g) => g.key === params.group) ? params.group : "all") as ActivityGroup | "all";
  const days = DAY_OPTIONS.includes(Number(params.days)) ? Number(params.days) : 7;
  const clientFilter = params.client ?? "";

  const { items, capped } = await getActivity(days);
  const clientsInFeed = [...new Map(items.filter((i) => i.clientId).map((i) => [i.clientId!, i.clientName ?? ""])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const filtered = items
    .filter((i) => group === "all" || i.group === group)
    .filter((i) => !clientFilter || i.clientId === clientFilter);
  const dayGroups = groupByDay(filtered);
  const qs = (over: Record<string, string>) => {
    const p = new URLSearchParams({ group, days: String(days), client: clientFilter, ...over });
    if (p.get("group") === "all") p.delete("group");
    if (!p.get("client")) p.delete("client");
    return `/admin/activity?${p.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        subtitle="Everything happening across the portal — logins, what clients look at, changes, quotes and sync runs."
      />

      <div className="flex flex-wrap items-center gap-2">
        {GROUPS.map((g) => (
          <Link
            key={g.key}
            href={qs({ group: g.key })}
            className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${
              group === g.key ? "bg-ink text-white" : "bg-line-soft text-ink-3 hover:bg-line"
            }`}
          >
            {g.label}
          </Link>
        ))}
        <span className="mx-1 text-line">|</span>
        {DAY_OPTIONS.map((d) => (
          <Link
            key={d}
            href={qs({ days: String(d) })}
            className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${
              days === d ? "bg-ink text-white" : "bg-line-soft text-ink-3 hover:bg-line"
            }`}
          >
            {d === 1 ? "Today" : `${d} days`}
          </Link>
        ))}
        <form className="ml-auto" action="/admin/activity" method="get">
          <input type="hidden" name="group" value={group === "all" ? "" : group} />
          <input type="hidden" name="days" value={days} />
          <select
            name="client"
            defaultValue={clientFilter}
            className="rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none"
          >
            <option value="">All clients</option>
            {clientsInFeed.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <button className="ml-2 rounded-lg bg-ink px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-black">
            Filter
          </button>
        </form>
      </div>

      {capped && (
        <p className="text-[13px] text-muted">Showing the most recent activity — narrow the window for a complete view.</p>
      )}

      {dayGroups.length === 0 ? (
        <Card>
          <p className="px-4 py-6 text-sm text-muted">Nothing in this window yet.</p>
        </Card>
      ) : (
        dayGroups.map((g) => (
          <Card key={g.day}>
            <CardHeader title={g.day} count={g.items.length} />
            <ul>
              {g.items.map((item, i) => (
                <li key={i} className="flex items-baseline gap-3 border-b border-line-soft px-4 py-2.5 text-sm last:border-0">
                  <span className="shrink-0 font-mono text-xs text-faint">{fmtTime(item.at)}</span>
                  <span className="shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-3">
                    {item.group}
                  </span>
                  <span className="min-w-0 text-ink">
                    {item.actor && <span className="font-medium capitalize">{item.actor} </span>}
                    {item.clientName && <span className="text-muted">({item.clientName}) </span>}
                    {item.href ? (
                      <Link href={item.href} className="hover:text-brand">
                        {item.text}
                      </Link>
                    ) : (
                      item.text
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 3: Nav entry**

`lib/nav.ts`, rocking_staff → Clients group, after Users:

```ts
        { label: "Activity", href: "/admin/activity" },
```

- [ ] **Step 4: Build**

`npm run build` → clean, `/admin/activity` in route list.

- [ ] **Step 5: Commit**

```bash
git add lib/views/activity.ts "app/(admin)/admin/activity/page.tsx" lib/nav.ts
git commit -m "feat(activity): admin activity feed page with merge-on-read sources"
```

---

### Task 5: Verify end-to-end + push

- [ ] **Step 1:** `npm test && npm run build` — green.
- [ ] **Step 2:** Programmatic capture check: simulate a client visit by calling the upsert path (insert a visit row twice for the same user/section/hour via service key) — second insert must be a no-op; verify a login row appears when no prior activity exists.
- [ ] **Step 3:** Feed check on `/admin/activity` (or via prod after deploy): sources render (there is real data: quote_events, import_runs from nightly pulls, device_changes, support entries); chips and client dropdown filter; non-staff redirected.
- [ ] **Step 4:** `git push origin main`; after deploy, browse the portal as a client user once, confirm the visit/login rows appear in the feed.
