# Calendly Availability & Booking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tim's Calendly becomes the availability oracle for paid support slots, and confirmed bookings are created in his Calendly (which invites him + the client and blocks his real calendar) — with full fallback to the internal grid whenever Calendly is unmapped or unreachable.

**Architecture:** A pure normalization layer (`calendly-helpers`) turns Calendly's available-times payloads into the existing `{iso,label}` slot shape and chunks date windows ≤7 days. A fail-soft network client (`calendly-availability`) reads availability and creates/cancels bookings with `CALENDLY_API_TOKEN_TIM`. `getOpenSlots` becomes per-service: Calendly when the service is mapped and reachable (internal bookings still subtracted as a double-book backstop), internal grid otherwise. `confirmBooking` gains a best-effort create-in-Calendly side-effect; `cancelBooking` best-effort cancels there.

**Tech Stack:** Next.js 16, Supabase, Calendly API v2 (`event_type_available_times`, Scheduling API `POST /invitees`, `POST /scheduled_events/{uuid}/cancellation`), vitest.

**Spec:** `docs/superpowers/specs/2026-07-30-calendly-availability-design.md`

**Verified empirically before this plan:** available-times response shape is
`{ start_time: "2026-08-03T10:00:00Z", status: "available", invitees_remaining: 1, scheduling_url }`;
both tokens authenticate; Tim's busy-times endpoint is not plan-gated; quote-link
minting (Shawn's token) unaffected. Create-invitee is documented as
`POST https://api.calendly.com/invitees` with `{ event_type, start_time, invitee: { name, email, timezone } }`,
paid-plan gated — final live verification happens in Task 6 once Tim's account is ready.

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs` — verify `cat supabase/.temp/project-ref` before pushing. Next migration number: **0051** (confirm with `ls supabase/migrations | tail -1` at build time; renumber if another session landed one).
- All commands from `/Users/shawnjooste/Documents/Claude/dashboard-v2`; quote parenthesized paths.
- Tokens: `CALENDLY_API_TOKEN_TIM` (support), `CALENDLY_API_TOKEN_SHAWN` (quotes — DO NOT touch `lib/calendly.ts` behavior). Never print token values. Tim's token already in Vercel (Preview+Production).
- Every Calendly failure is fail-soft: reads fall back to the internal grid; writes never lose a paid booking. Mirror `createSingleUseBookingLink`'s pattern (log + null, never throw to callers).
- Internal double-book guard (`slotTaken` over our own bookings) applies in BOTH availability paths.
- Query available-times in windows of **≤7 days** per call (observed to accept 8, but the documented cap is 7 — chunk defensively).
- Pure helpers live in import-free files (vitest must not pull `@/lib/supabase/server`).
- SAST is fixed UTC+2; slot labels via the existing `slotLabel` format ("Mon 27 Jul, 08:00").
- If git hangs on `.git/index.lock` (Cursor's git worker), remove the stale lock and retry.

## File Structure

- `lib/calendly-helpers.ts` (+ `.test.ts`) — NEW, pure: `slotLabel` (moved here from `lib/views/bookings.ts`), `normalizeCalendlySlots`, `chunkWindows`.
- `lib/calendly-availability.ts` — NEW, network: `SUPPORT_HOST_TOKEN_ENV`, `getCalendlySlots`, `createCalendlyBooking`, `cancelCalendlyEvent`.
- `supabase/migrations/0051_calendly_mapping.sql` — two nullable columns.
- `lib/views/bookings.ts` — per-service slots + expose mapping; re-export `slotLabel`.
- `lib/actions/bookings.ts` — `saveServiceCalendly` merged into the price form handling; `cancelBooking` cancels in Calendly.
- `lib/booking-confirm.ts` — create-in-Calendly side-effect + store event URI.
- `components/BookSession.tsx` + `app/(app)/support/page.tsx` — per-service slot lists.
- `app/(admin)/admin/support-packages/page.tsx` — event-type URI field per service.
- `app/(admin)/admin/bookings/page.tsx` — "no calendar event" marker.

---

### Task 1: Pure helpers — slotLabel move, normalization, windowing (TDD)

**Files:**
- Create: `lib/calendly-helpers.ts`
- Test: `lib/calendly-helpers.test.ts`
- Modify: `lib/views/bookings.ts` (import + re-export `slotLabel` instead of defining it)
- Modify: `lib/booking-confirm.ts` (import `slotLabel` from the new pure home)

**Interfaces:**
- Produces: `slotLabel(iso: string): string` (unchanged behavior, new home);
  `normalizeCalendlySlots(collection: { start_time: string; status: string }[]): { iso: string; label: string }[]`
  (available only, on-the-hour or not — trust Calendly; normalized to `Date.toISOString()` form, sorted ascending, deduped);
  `chunkWindows(start: Date, endExclusive: Date, maxDays: number): { start: string; end: string }[]`.

- [ ] **Step 1: Write the failing test**

`lib/calendly-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { chunkWindows, normalizeCalendlySlots, slotLabel } from "./calendly-helpers";

describe("slotLabel", () => {
  it("renders SAST from a stored UTC slot", () => {
    expect(slotLabel("2026-07-27T06:00:00.000Z")).toBe("Mon 27 Jul, 08:00");
  });
});

describe("normalizeCalendlySlots", () => {
  const raw = [
    { start_time: "2026-08-03T10:00:00Z", status: "available" },
    { start_time: "2026-08-03T08:00:00Z", status: "available" },
    { start_time: "2026-08-03T09:00:00Z", status: "unavailable" },
    { start_time: "2026-08-03T08:00:00Z", status: "available" }, // dupe
  ];
  it("keeps available slots only, sorted, deduped, normalized ISO", () => {
    const slots = normalizeCalendlySlots(raw);
    expect(slots.map((s) => s.iso)).toEqual(["2026-08-03T08:00:00.000Z", "2026-08-03T10:00:00.000Z"]);
  });
  it("labels in SAST", () => {
    expect(normalizeCalendlySlots(raw)[0].label).toBe("Mon 3 Aug, 10:00");
  });
  it("handles an empty collection", () => {
    expect(normalizeCalendlySlots([])).toEqual([]);
  });
});

describe("chunkWindows", () => {
  it("splits a 14-day range into 7-day windows", () => {
    const w = chunkWindows(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-15T00:00:00Z"), 7);
    expect(w).toEqual([
      { start: "2026-08-01T00:00:00.000Z", end: "2026-08-08T00:00:00.000Z" },
      { start: "2026-08-08T00:00:00.000Z", end: "2026-08-15T00:00:00.000Z" },
    ]);
  });
  it("keeps a short range as one window", () => {
    const w = chunkWindows(new Date("2026-08-01T00:00:00Z"), new Date("2026-08-04T00:00:00Z"), 7);
    expect(w).toHaveLength(1);
    expect(w[0].end).toBe("2026-08-04T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/calendly-helpers.test.ts` → cannot resolve module.

- [ ] **Step 3: Implement**

`lib/calendly-helpers.ts`:

```ts
/** Pure Calendly payload/label helpers — no server imports (vitest-safe). */

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 27 Jul, 08:00" in SAST (fixed UTC+2) for a stored UTC slot. */
export function slotLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 2 * 3_600_000);
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}

/** Calendly event_type_available_times → the portal's slot shape.
 *  Available only, ISO-normalized, deduped, ascending. */
export function normalizeCalendlySlots(
  collection: { start_time: string; status: string }[],
): { iso: string; label: string }[] {
  const isos = [
    ...new Set(
      collection
        .filter((s) => s.status === "available")
        .map((s) => new Date(s.start_time).toISOString()),
    ),
  ].sort();
  return isos.map((iso) => ({ iso, label: slotLabel(iso) }));
}

/** Split [start, endExclusive) into windows of at most maxDays. */
export function chunkWindows(
  start: Date,
  endExclusive: Date,
  maxDays: number,
): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = [];
  let cursor = start.getTime();
  const endMs = endExclusive.getTime();
  const step = maxDays * 86_400_000;
  while (cursor < endMs) {
    const winEnd = Math.min(cursor + step, endMs);
    out.push({ start: new Date(cursor).toISOString(), end: new Date(winEnd).toISOString() });
    cursor = winEnd;
  }
  return out;
}
```

- [ ] **Step 4: Point existing code at the new home**

In `lib/views/bookings.ts`: delete the local `DAY`/`MON` constants and `slotLabel` definition; add
`import { slotLabel } from "@/lib/calendly-helpers";` and keep the export for existing importers:
`export { slotLabel };`
In `lib/booking-confirm.ts`: change `import { slotLabel } from "@/lib/views/bookings";` to
`import { slotLabel } from "@/lib/calendly-helpers";`.

- [ ] **Step 5: Run tests + typecheck** — `npx vitest run lib/calendly-helpers.test.ts && npx tsc --noEmit && npm test` → new tests pass, suite green (existing `slotLabel` behavior covered transitively by unchanged snapshots of labels in booking tests).

- [ ] **Step 6: Commit**

```bash
git add lib/calendly-helpers.ts lib/calendly-helpers.test.ts lib/views/bookings.ts lib/booking-confirm.ts
git commit -m "feat(calendly): pure slot normalization + windowing; slotLabel moves to pure home"
```

---

### Task 2: Fail-soft Calendly client for support

**Files:**
- Create: `lib/calendly-availability.ts`

**Interfaces:**
- Produces: `SUPPORT_HOST_TOKEN_ENV = "CALENDLY_API_TOKEN_TIM"`;
  `getCalendlySlots(eventTypeUri: string, opts?: { days?: number }): Promise<{ iso: string; label: string }[] | null>` (null = unavailable/error → caller falls back);
  `createCalendlyBooking(opts: { eventTypeUri: string; startIso: string; invitee: { name: string; email: string }; note?: string | null }): Promise<{ eventUri: string | null } | null>` (null = failed);
  `cancelCalendlyEvent(eventUri: string, reason: string): Promise<boolean>`.

- [ ] **Step 1: Write the client**

`lib/calendly-availability.ts`:

```ts
// Calendly as the SUPPORT availability oracle + booking writer. Tim's token —
// per-person convention (see lib/calendly.ts and the per-person-tokens note).
// EVERYTHING here is fail-soft: reads return null (caller falls back to the
// internal grid), writes return null/false (a paid booking must never depend
// on Calendly succeeding).
import "server-only";
import { chunkWindows, normalizeCalendlySlots } from "@/lib/calendly-helpers";

export const SUPPORT_HOST_TOKEN_ENV = "CALENDLY_API_TOKEN_TIM";
const MAX_WINDOW_DAYS = 7; // documented cap for event_type_available_times

function token(): string | null {
  return process.env[SUPPORT_HOST_TOKEN_ENV] ?? null;
}

async function cget(path: string): Promise<Record<string, unknown> | null> {
  const t = token();
  if (!t) {
    console.warn(`${SUPPORT_HOST_TOKEN_ENV} not set — Calendly availability disabled`);
    return null;
  }
  try {
    const res = await fetch(`https://api.calendly.com${path}`, {
      headers: { Authorization: `Bearer ${t}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`Calendly GET ${path.split("?")[0]} failed:`, res.status);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    console.error("Calendly GET error:", e);
    return null;
  }
}

/** Bookable slots for an event type over the next `days` days (default 14),
 *  starting one hour from now. Null on any failure — caller must fall back. */
export async function getCalendlySlots(
  eventTypeUri: string,
  opts?: { days?: number },
): Promise<{ iso: string; label: string }[] | null> {
  const start = new Date(Date.now() + 3_600_000);
  const end = new Date(Date.now() + (opts?.days ?? 14) * 86_400_000);
  const windows = chunkWindows(start, end, MAX_WINDOW_DAYS);
  const collected: { start_time: string; status: string }[] = [];
  for (const w of windows) {
    const json = await cget(
      `/event_type_available_times?event_type=${encodeURIComponent(eventTypeUri)}&start_time=${encodeURIComponent(w.start)}&end_time=${encodeURIComponent(w.end)}`,
    );
    if (!json) return null; // any window failing → whole read is unreliable
    collected.push(...((json.collection as { start_time: string; status: string }[]) ?? []));
  }
  return normalizeCalendlySlots(collected);
}

/** Books the meeting in Calendly (Scheduling API). Calendly invites the
 *  client AND Tim, and blocks his calendar. Null = failed (log only). */
export async function createCalendlyBooking(opts: {
  eventTypeUri: string;
  startIso: string;
  invitee: { name: string; email: string };
  note?: string | null;
}): Promise<{ eventUri: string | null } | null> {
  const t = token();
  if (!t) return null;
  try {
    const res = await fetch("https://api.calendly.com/invitees", {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: opts.eventTypeUri,
        start_time: opts.startIso,
        invitee: {
          name: opts.invitee.name,
          email: opts.invitee.email,
          timezone: "Africa/Johannesburg",
        },
      }),
    });
    if (!res.ok) {
      console.error("Calendly create invitee failed:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const body = (await res.json()) as { resource?: { event?: string | { uri?: string }; uri?: string } };
    const ev = body.resource?.event;
    const eventUri = typeof ev === "string" ? ev : (ev?.uri ?? null);
    return { eventUri };
  } catch (e) {
    console.error("Calendly create invitee error:", e);
    return null;
  }
}

/** Best-effort cancellation so Tim's calendar frees up. */
export async function cancelCalendlyEvent(eventUri: string, reason: string): Promise<boolean> {
  const t = token();
  if (!t) return false;
  const uuid = eventUri.split("/").pop();
  if (!uuid) return false;
  try {
    const res = await fetch(`https://api.calendly.com/scheduled_events/${uuid}/cancellation`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    if (!res.ok) console.error("Calendly cancel failed:", res.status);
    return res.ok;
  } catch (e) {
    console.error("Calendly cancel error:", e);
    return false;
  }
}
```

- [ ] **Step 2: Typecheck + suite** — `npx tsc --noEmit && npm test` → clean/green.

- [ ] **Step 3: Commit**

```bash
git add lib/calendly-availability.ts
git commit -m "feat(calendly): fail-soft availability/booking client for support (Tim's token)"
```

---

### Task 3: Migration 0051 — mapping columns

**Files:**
- Create: `supabase/migrations/0051_calendly_mapping.sql`
- Modify: `lib/types/database.ts` (regenerated)

- [ ] **Step 1: Write the migration**

```sql
-- Calendly wiring for paid support bookings. A service mapped to a Calendly
-- event type sources its slots from Calendly (Tim's real calendar) and paid
-- bookings are created there too. Null mapping = internal grid (fallback).
alter table public.support_services
  add column calendly_event_type_uri text;

alter table public.support_bookings
  add column calendly_event_uri text;
```

- [ ] **Step 2: Push** — `cat supabase/.temp/project-ref` (must be `eskhokedsximnslgsycs`), `ls supabase/migrations | tail -1` (renumber if 0051 is taken), then `npx supabase db push --linked` → Finished.

- [ ] **Step 3: Regen types + typecheck** — `npx supabase gen types typescript --linked > lib/types/database.ts && npx tsc --noEmit` → clean (clear `.next` "* 2.*" dupes if the known Finder-copy junk reappears).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0051_calendly_mapping.sql lib/types/database.ts
git commit -m "feat(calendly): service event-type mapping + booking event uri columns"
```

---

### Task 4: Wiring — per-service slots, confirm/cancel side-effects, actions

**Files:**
- Modify: `lib/views/bookings.ts`
- Modify: `lib/actions/bookings.ts`
- Modify: `lib/booking-confirm.ts`

**Interfaces:**
- `BookingService` gains `calendlyEventTypeUri: string | null`.
- `getOpenSlots()` REPLACED by `getOpenSlotsByService(services: BookingService[]): Promise<Record<string, { iso: string; label: string }[]>>` — keyed by service id.
- `Booking` gains `calendlyEventUri: string | null` and `serviceMapped: boolean`.
- `saveServicePrice` also persists `calendly_event_type_uri` from a `calendly_uri` form field (empty string → null).
- `cancelBooking` cancels the Calendly event when present.
- `confirmBooking` creates the Calendly booking when the service is mapped; stores `calendly_event_uri`.

- [ ] **Step 1: Views — per-service availability with fallback + backstop**

In `lib/views/bookings.ts`:

Add to imports: `import { getCalendlySlots } from "@/lib/calendly-availability";` and extend `slotTaken` import from booking-helpers (already imported: `PENDING_HOLD_MINUTES, openSlots` — add `slotTaken`, type `SlotBlocker` already there).

`BookingService`: add `calendlyEventTypeUri: string | null`; select `calendly_event_type_uri` in `getActiveServices` and map it.

Replace `getOpenSlots` with:

```ts
/** Per-service open slots. Calendly (Tim's real calendar) when the service is
 *  mapped and reachable; internal business-hours grid otherwise. In BOTH
 *  paths our own live bookings are subtracted — the internal double-book
 *  backstop against Calendly sync lag. */
export async function getOpenSlotsByService(
  services: BookingService[],
): Promise<Record<string, { iso: string; label: string }[]>> {
  const service = createServiceClient();
  const { data } = await service
    .from("support_bookings")
    .select("slot_start, status, created_at")
    .gte("slot_start", new Date().toISOString());
  const blockers = (data ?? []) as SlotBlocker[];
  const now = new Date();
  const internal = openSlots({ now, businessDays: 10, blockers });

  const out: Record<string, { iso: string; label: string }[]> = {};
  for (const svc of services) {
    let slots: { iso: string; label: string }[] | null = null;
    if (svc.calendlyEventTypeUri) {
      slots = await getCalendlySlots(svc.calendlyEventTypeUri);
      if (slots) slots = slots.filter((s) => !slotTaken(s.iso, blockers, now));
    }
    out[svc.id] = slots ?? internal;
  }
  return out;
}
```

`Booking` type + `toBooking` + `SELECT`: add `calendly_event_uri` (→ `calendlyEventUri`) and, for the admin marker, extend the select's joined service to `support_services(name, calendly_event_type_uri)` with `serviceMapped: !!b.support_services?.calendly_event_type_uri` in `toBooking` (update the `BookingRow` type accordingly).

- [ ] **Step 2: Actions — price form carries the mapping; cancel frees Tim's calendar**

In `lib/actions/bookings.ts`:

`saveServicePrice` — after the price update object, include the mapping:

```ts
    .update({
      price_cents: Math.round(rands * 100),
      calendly_event_type_uri: str(formData, "calendly_uri"),
    })
```

(`str()` already returns null for empty — an emptied field unmaps the service.)
Validate lightly before the update:

```ts
  const uri = str(formData, "calendly_uri");
  if (uri && !uri.startsWith("https://api.calendly.com/event_types/")) {
    throw new Error("Calendly event type URI must look like https://api.calendly.com/event_types/…");
  }
```

and use `calendly_event_type_uri: uri` in the update.

`cancelBooking` — after the status update, add:

```ts
  const { data: b } = await service
    .from("support_bookings")
    .select("calendly_event_uri")
    .eq("id", id)
    .maybeSingle();
  if (b?.calendly_event_uri) {
    await cancelCalendlyEvent(b.calendly_event_uri, "Cancelled via the Rocking portal");
  }
```

with `import { cancelCalendlyEvent } from "@/lib/calendly-availability";`.
(Order note: fetch the URI BEFORE or after the update is equivalent — the update never clears it.)

- [ ] **Step 3: Confirm — create the Calendly booking on payment**

In `lib/booking-confirm.ts`, extend the select with `calendly_event_uri` on the booking and `calendly_event_type_uri` on the joined service (`support_services(key, name, calendly_event_type_uri)`), and inside the existing best-effort `try` block — after the FreeScout ticket + email — add:

```ts
      const evtType = (svc as unknown as { calendly_event_type_uri?: string | null })?.calendly_event_type_uri;
      if (evtType) {
        const created = await createCalendlyBooking({
          eventTypeUri: evtType,
          startIso: b.slot_start,
          invitee: { name: email.split("@")[0], email },
          note: b.note,
        });
        if (created?.eventUri) {
          await service.from("support_bookings").update({ calendly_event_uri: created.eventUri }).eq("id", b.id);
        }
      }
```

with `import { createCalendlyBooking } from "@/lib/calendly-availability";`.
(Invitee name: use the booker's person display name when available — fetch it in the same profiles query by extending the select to `email, person_id, people:person_id(display_name)` and use `display_name ?? email.split("@")[0]`.)

- [ ] **Step 4: Typecheck + suite** — `npx tsc --noEmit && npm test` → clean/green (build check comes with the UI task; `getOpenSlots` callers are fixed there).

Note: `app/(app)/support/page.tsx` still calls `getOpenSlots` at this point — the build breaks until Task 5. That's fine mid-task-sequence; commit both together if preferred, but the plan keeps them separate commits with the UI commit following immediately.

- [ ] **Step 5: Commit**

```bash
git add lib/views/bookings.ts lib/actions/bookings.ts lib/booking-confirm.ts
git commit -m "feat(calendly): per-service slots with fallback; create/cancel bookings in Calendly"
```

---

### Task 5: UI — per-service slot lists, admin mapping field, admin marker

**Files:**
- Modify: `components/BookSession.tsx`
- Modify: `app/(app)/support/page.tsx`
- Modify: `app/(admin)/admin/support-packages/page.tsx`
- Modify: `app/(admin)/admin/bookings/page.tsx`

- [ ] **Step 1: BookSession switches slot lists per service**

`components/BookSession.tsx` — change the props and derived slots:

```tsx
export function BookSession({
  services,
  slotsByService,
}: {
  services: BookingService[];
  slotsByService: Record<string, { iso: string; label: string }[]>;
}) {
```

and inside the component replace uses of `slots` with:

```tsx
  const slots = slotsByService[serviceId] ?? [];
```

(after the `serviceId` state declaration; `days`/`daySlots` derivations stay as-is, operating on the derived `slots`). Reset the chosen day when the service changes:

```tsx
  const onService = (id: string) => {
    setServiceId(id);
    setDay("");
  };
```

wired to the service `<select onChange={(e) => onService(e.target.value)}>`.

- [ ] **Step 2: Support page fetches per-service slots**

`app/(app)/support/page.tsx`:

```tsx
  const services = await getActiveServices();
  const [slotsByService, bookings] = await Promise.all([
    getOpenSlotsByService(services),
    getClientBookings(),
  ]);
```

(replacing the previous three-way `Promise.all`; imports change from `getOpenSlots` to `getOpenSlotsByService`), and pass `<BookSession services={services} slotsByService={slotsByService} />`.

- [ ] **Step 3: Admin — event-type URI field on the price form**

`app/(admin)/admin/support-packages/page.tsx`, inside the Paid session prices form, after the incl-VAT span:

```tsx
            <input
              name="calendly_uri"
              defaultValue={s.calendlyEventTypeUri ?? ""}
              placeholder="Calendly event type URI (blank = internal grid)"
              className={`${FIELD} min-w-0 flex-1`}
            />
```

- [ ] **Step 4: Admin bookings — missing-calendar marker**

`app/(admin)/admin/bookings/page.tsx`, in `Row`, after the status span:

```tsx
      {b.status === "paid" && b.serviceMapped && !b.calendlyEventUri && (
        <span className="shrink-0 rounded bg-warn-tint px-1.5 py-0.5 text-[11px] font-medium text-warn-ink" title="Calendly booking failed — Tim's calendar doesn't have this session; add it manually.">
          no calendar event
        </span>
      )}
```

- [ ] **Step 5: Tests + build** — `npm test && npm run build` → suite green, build clean, both `/support` and admin routes compile.

- [ ] **Step 6: Commit**

```bash
git add components/BookSession.tsx "app/(app)/support/page.tsx" "app/(admin)/admin/support-packages/page.tsx" "app/(admin)/admin/bookings/page.tsx"
git commit -m "feat(calendly): per-service slot UI, admin mapping field, no-calendar-event marker"
```

---

### Task 6: Verification + ship

- [ ] **Step 1: Regression (fallback path).** With NO services mapped (default state): `npm test && npm run build`, then confirm via a service-role script that `getOpenSlotsByService`-equivalent data (internal grid) matches pre-phase behavior — i.e. the support page still offers weekday hourly slots. This is the "today's behavior" guarantee.
- [ ] **Step 2: Availability smoke test with a real event type.** Once Tim's prerequisites are done (timezone, calendar connection, paid plan, event types), a script hits `event_type_available_times` for his "Remote support session" event type and prints slot count for the next 7 days; a block Tim places in his calendar must remove that hour on re-run. If Tim isn't ready yet, run the same smoke test against Shawn's TeamsCall event type (already verified working) purely to prove the code path, and defer the Tim-specific check.
- [ ] **Step 3: Booking write smoke test.** Map a TEST event type, create a pending booking via service role, run `confirmBooking` with the right amount (signed-webhook route against prod, as in Phase 2's verification) and confirm: `calendly_event_uri` stored, event visible in Calendly, invite emails sent. Then `cancelBooking` and confirm the Calendly event cancels. Clean up rows + FreeScout ticket.
- [ ] **Step 4: Ship.** `git push origin main`, wait for deploy, spot-check `/support` (fallback grid until mapping is set) and the admin pages.
- [ ] **Step 5: Go live.** Paste the two real event-type URIs into the admin price form (or Shawn does), re-check `/support` now shows Calendly-driven slots that differ per service.
