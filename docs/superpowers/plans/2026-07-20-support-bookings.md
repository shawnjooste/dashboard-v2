# Support Bookings (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clients book and pay for remote/onsite support sessions from the portal — Paystack card upfront, webhook-confirmed, FreeScout ticket + email on payment.

**Architecture:** `support_services` (prices as data) + `support_bookings` (status machine `pending_payment → paid → completed/cancelled`). Pure helpers own slot math and money; `lib/paystack.ts` wraps initialize/verify/signature; a single idempotent `confirmBooking()` is called by both the webhook route and the booking page's verify fallback, so payment truth has two independent paths to land. Slot availability reads via the service client (a client must not see other clients' bookings, but must not double-book their slots either) exposing only times.

**Tech Stack:** Next.js 16 (server components/actions + first route handler), Supabase RLS, Paystack API (ZAR, amounts in cents), Resend, vitest.

**Spec:** `docs/superpowers/specs/2026-07-16-support-bookings-design.md`

## Global Constraints

- Supabase ref `eskhokedsximnslgsycs` — verify `cat supabase/.temp/project-ref` before any push. Never `qomxwxxulxcwnpaqzudl`.
- All commands from `/Users/shawnjooste/Documents/Claude/dashboard-v2`. Quote parenthesized paths.
- Next migration number is **0050** (0045–0049 landed since Phase 1).
- Prices seeded: remote **100000** cents (R1,000 ex), onsite **125000** cents (R1,250 ex). VAT **15%**. Paystack ZAR amounts are in **cents**.
- Slots: **Mon–Fri, 08:00–17:00 SAST (fixed UTC+2, no DST), 60-min, capacity 1 across the team**; bookable window = the **next 10 business days starting tomorrow**; `pending_payment` holds a slot for **30 minutes** (computed at read time).
- Secrets: `PAYSTACK_SECRET_KEY` (live) / `PAYSTACK_TEST_SECRET_KEY` in `.env.local`; `PAYSTACK_USE_TEST=1` selects test mode. **Never print or commit key values.** Live key already in Vercel env.
- The webhook is the source of truth; the redirect is cosmetic. `confirmBooking` must be idempotent and must still record payment if FreeScout/email side-effects fail.
- Refunds/reschedules manual; credits explicitly out of scope (deferred phase).
- Pure helpers in import-free files (vitest must not pull `@/lib/supabase/server`; `node:crypto` is fine).
- Design tokens/components as in Phase 1 (`Card`, `CardHeader`, `PageHeader`, `FIELD` input style).
- If git hangs on `.git/index.lock` (Cursor's git worker), remove the stale lock and retry.

## File Structure

- `lib/booking-helpers.ts` (+ `.test.ts`) — slot generation/blocking, money math, label formatting. Pure.
- `lib/paystack.ts` — env-picked secret, `initializeTransaction`, `verifyTransaction`; `lib/paystack-signature.ts` (+ `.test.ts`) — pure HMAC check.
- `supabase/migrations/0050_support_bookings.sql` — tables, seeds, RLS.
- `lib/views/bookings.ts` — RLS reads for pages; service-client slot availability (times only).
- `lib/actions/bookings.ts` — createBooking (client), staff booking admin + price edits.
- `lib/booking-confirm.ts` — idempotent confirm (mark paid → FreeScout → email).
- `lib/notify.ts` — add exported `sendBookingConfirmation` (reuses private `sendEmail`, category `"booking"`).
- `app/api/paystack/webhook/route.ts` — signature-verified webhook.
- `components/BookSession.tsx` (client form) + additions to `app/(app)/support/page.tsx`; `app/(app)/support/bookings/[id]/page.tsx`.
- `app/(admin)/admin/support-packages/page.tsx` — services price card + bookings card.

---

### Task 1: Pure booking helpers + tests (TDD)

**Files:**
- Create: `lib/booking-helpers.ts`
- Test: `lib/booking-helpers.test.ts`

**Interfaces (produced for Tasks 4–7):**
- `PENDING_HOLD_MINUTES = 30`, `VAT_RATE = 0.15`
- `type SlotBlocker = { slot_start: string; status: string; created_at: string }`
- `slotTaken(slotStartIso: string, blockers: SlotBlocker[], now: Date): boolean`
- `openSlots(opts: { now: Date; businessDays: number; blockers: SlotBlocker[] }): { iso: string; label: string }[]`
- `vatCents(priceCents: number): number`; `totalCents(priceCents: number): number`
- `fmtRands(cents: number): string` — `100000` → `"R 1 000,00"`

- [ ] **Step 1: Write the failing test**

`lib/booking-helpers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  PENDING_HOLD_MINUTES,
  fmtRands,
  openSlots,
  slotTaken,
  totalCents,
  vatCents,
  type SlotBlocker,
} from "./booking-helpers";

// Fri 2026-07-24 10:00 SAST = 08:00Z
const NOW = new Date("2026-07-24T08:00:00Z");
const mk = (o: Partial<SlotBlocker> = {}): SlotBlocker => ({
  slot_start: o.slot_start ?? "2026-07-27T06:00:00.000Z", // Mon 08:00 SAST
  status: o.status ?? "paid",
  created_at: o.created_at ?? "2026-07-24T07:00:00Z",
});

describe("slotTaken", () => {
  const slot = "2026-07-27T06:00:00.000Z";
  it("paid booking blocks the slot", () => {
    expect(slotTaken(slot, [mk({ status: "paid" })], NOW)).toBe(true);
  });
  it("completed booking blocks the slot", () => {
    expect(slotTaken(slot, [mk({ status: "completed" })], NOW)).toBe(true);
  });
  it("cancelled booking frees the slot", () => {
    expect(slotTaken(slot, [mk({ status: "cancelled" })], NOW)).toBe(false);
  });
  it("fresh pending hold blocks the slot", () => {
    expect(slotTaken(slot, [mk({ status: "pending_payment", created_at: "2026-07-24T07:50:00Z" })], NOW)).toBe(true);
  });
  it("stale pending hold (>30 min) frees the slot", () => {
    expect(slotTaken(slot, [mk({ status: "pending_payment", created_at: "2026-07-24T07:20:00Z" })], NOW)).toBe(false);
  });
  it("a different slot does not block", () => {
    expect(slotTaken("2026-07-27T07:00:00.000Z", [mk()], NOW)).toBe(false);
  });
});

describe("openSlots", () => {
  it("generates 9 hourly slots per business day, weekends excluded", () => {
    const slots = openSlots({ now: NOW, businessDays: 2, blockers: [] });
    expect(slots).toHaveLength(18);
    // NOW is Friday → next business days are Mon 27 + Tue 28
    expect(slots[0].iso).toBe("2026-07-27T06:00:00.000Z"); // Mon 08:00 SAST
    expect(slots[8].iso).toBe("2026-07-27T14:00:00.000Z"); // Mon 16:00 SAST (last)
    expect(slots[9].iso).toBe("2026-07-28T06:00:00.000Z"); // Tue 08:00 SAST
    expect(slots.every((s) => !s.iso.includes("2026-07-25") && !s.iso.includes("2026-07-26"))).toBe(true);
  });
  it("labels slots in SAST", () => {
    const slots = openSlots({ now: NOW, businessDays: 1, blockers: [] });
    expect(slots[0].label).toBe("Mon 27 Jul, 08:00");
    expect(slots[8].label).toBe("Mon 27 Jul, 16:00");
  });
  it("excludes blocked slots", () => {
    const slots = openSlots({ now: NOW, businessDays: 1, blockers: [mk()] });
    expect(slots).toHaveLength(8);
    expect(slots.some((s) => s.iso === "2026-07-27T06:00:00.000Z")).toBe(false);
  });
});

describe("money", () => {
  it("computes 15% VAT in cents", () => {
    expect(vatCents(100000)).toBe(15000);
    expect(vatCents(125000)).toBe(18750);
  });
  it("computes the total", () => {
    expect(totalCents(100000)).toBe(115000);
  });
  it("formats rands with space thousands and comma decimals", () => {
    expect(fmtRands(100000)).toBe("R 1 000,00");
    expect(fmtRands(115000)).toBe("R 1 150,00");
    expect(fmtRands(18750)).toBe("R 187,50");
  });
});

describe("constants", () => {
  it("pending hold is 30 minutes", () => {
    expect(PENDING_HOLD_MINUTES).toBe(30);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/booking-helpers.test.ts`
Expected: FAIL — cannot resolve `./booking-helpers`.

- [ ] **Step 3: Implement**

`lib/booking-helpers.ts`:

```ts
/** Pure booking logic — no server imports (vitest-safe).
 *  All slot times are UTC ISO strings; SAST is a fixed UTC+2 (no DST). */

export const PENDING_HOLD_MINUTES = 30;
export const VAT_RATE = 0.15;
const SAST_OFFSET_H = 2;
const FIRST_HOUR_SAST = 8; // 08:00 first slot start
const LAST_HOUR_SAST = 16; // 16:00 last slot start (ends 17:00)

export type SlotBlocker = { slot_start: string; status: string; created_at: string };

/** A slot is taken by a paid/completed booking, or a pending one younger
 *  than the hold window. Cancelled and lapsed-pending bookings free it. */
export function slotTaken(slotStartIso: string, blockers: SlotBlocker[], now: Date): boolean {
  const t = new Date(slotStartIso).getTime();
  return blockers.some((b) => {
    if (new Date(b.slot_start).getTime() !== t) return false;
    if (b.status === "paid" || b.status === "completed") return true;
    if (b.status !== "pending_payment") return false;
    return now.getTime() - new Date(b.created_at).getTime() < PENDING_HOLD_MINUTES * 60_000;
  });
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Open slots for the next N business days starting TOMORROW (SAST). */
export function openSlots(opts: { now: Date; businessDays: number; blockers: SlotBlocker[] }): { iso: string; label: string }[] {
  const out: { iso: string; label: string }[] = [];
  // Walk days in SAST by shifting the clock +2h and using UTC accessors.
  const cursor = new Date(opts.now.getTime() + SAST_OFFSET_H * 3_600_000);
  cursor.setUTCHours(0, 0, 0, 0);
  let daysFound = 0;
  while (daysFound < opts.businessDays) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    daysFound++;
    for (let h = FIRST_HOUR_SAST; h <= LAST_HOUR_SAST; h++) {
      const startUtcMs = cursor.getTime() + (h - SAST_OFFSET_H) * 3_600_000;
      const iso = new Date(startUtcMs).toISOString();
      if (slotTaken(iso, opts.blockers, opts.now)) continue;
      out.push({
        iso,
        label: `${DAY[dow]} ${cursor.getUTCDate()} ${MON[cursor.getUTCMonth()]}, ${String(h).padStart(2, "0")}:00`,
      });
    }
  }
  return out;
}

export function vatCents(priceCents: number): number {
  return Math.round(priceCents * VAT_RATE);
}

export function totalCents(priceCents: number): number {
  return priceCents + vatCents(priceCents);
}

/** 115000 → "R 1 150,00" (space thousands, comma decimals — deterministic). */
export function fmtRands(cents: number): string {
  const [whole, dec] = (cents / 100).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `R ${grouped},${dec}`;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/booking-helpers.test.ts` → all pass; then `npm test` → whole suite green.

- [ ] **Step 5: Commit**

```bash
git add lib/booking-helpers.ts lib/booking-helpers.test.ts
git commit -m "feat(bookings): pure slot/money helpers"
```

---

### Task 2: Paystack client + signature verification (TDD on the pure part)

**Files:**
- Create: `lib/paystack-signature.ts`
- Test: `lib/paystack-signature.test.ts`
- Create: `lib/paystack.ts`

**Interfaces:**
- `verifyPaystackSignature(rawBody: string, signature: string | null, secret: string): boolean`
- `paystackSecret(): string` (test key when `PAYSTACK_USE_TEST=1`)
- `initializeTransaction(opts: { email: string; amountCents: number; reference: string; callbackUrl: string }): Promise<string>` — returns the authorization URL
- `verifyTransaction(reference: string): Promise<{ paid: boolean; amountCents: number }>`

- [ ] **Step 1: Write the failing signature test**

`lib/paystack-signature.test.ts`:

```ts
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaystackSignature } from "./paystack-signature";

const SECRET = "sk_test_dummy_for_tests";
const body = JSON.stringify({ event: "charge.success", data: { reference: "bk_x", amount: 115000 } });
const sig = createHmac("sha512", SECRET).update(body).digest("hex");

describe("verifyPaystackSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyPaystackSignature(body, sig, SECRET)).toBe(true);
  });
  it("rejects a tampered body", () => {
    expect(verifyPaystackSignature(body.replace("115000", "1"), sig, SECRET)).toBe(false);
  });
  it("rejects a missing signature", () => {
    expect(verifyPaystackSignature(body, null, SECRET)).toBe(false);
  });
  it("rejects a malformed signature without throwing", () => {
    expect(verifyPaystackSignature(body, "zz-not-hex", SECRET)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run lib/paystack-signature.test.ts` → cannot resolve module.

- [ ] **Step 3: Implement the pure part**

`lib/paystack-signature.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

/** Paystack signs the RAW webhook body with your secret key (HMAC-SHA512,
 *  hex, in the x-paystack-signature header). Constant-time comparison. */
export function verifyPaystackSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run lib/paystack-signature.test.ts` → 4 pass.

- [ ] **Step 5: Write the API client**

`lib/paystack.ts`:

```ts
/** Server-only Paystack REST client. ZAR amounts are in CENTS everywhere. */

const BASE = "https://api.paystack.co";

export function paystackSecret(): string {
  const key =
    process.env.PAYSTACK_USE_TEST === "1"
      ? process.env.PAYSTACK_TEST_SECRET_KEY
      : process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("Paystack secret key is not configured");
  return key;
}

async function ps(path: string, init?: RequestInit): Promise<{ status: boolean; message: string; data: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${paystackSecret()}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const json = await res.json();
  if (!res.ok || json.status !== true) throw new Error(`Paystack ${path} failed: ${json.message ?? res.status}`);
  return json;
}

/** Start a hosted checkout; returns the URL to redirect the client to. */
export async function initializeTransaction(opts: {
  email: string;
  amountCents: number;
  reference: string;
  callbackUrl: string;
}): Promise<string> {
  const json = await ps("/transaction/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: opts.email,
      amount: opts.amountCents,
      currency: "ZAR",
      reference: opts.reference,
      callback_url: opts.callbackUrl,
    }),
  });
  const url = json.data.authorization_url;
  if (typeof url !== "string") throw new Error("Paystack initialize returned no authorization_url");
  return url;
}

/** Server-side fallback check (the webhook is the primary truth). */
export async function verifyTransaction(reference: string): Promise<{ paid: boolean; amountCents: number }> {
  const json = await ps(`/transaction/verify/${encodeURIComponent(reference)}`);
  return { paid: json.data.status === "success", amountCents: Number(json.data.amount ?? 0) };
}
```

- [ ] **Step 6: Typecheck + full suite** — `npx tsc --noEmit && npm test` → clean/green.

- [ ] **Step 7: Commit**

```bash
git add lib/paystack-signature.ts lib/paystack-signature.test.ts lib/paystack.ts
git commit -m "feat(bookings): paystack client + signature verification"
```

---

### Task 3: Migration 0050 — services, bookings, RLS

**Files:**
- Create: `supabase/migrations/0050_support_bookings.sql`
- Modify: `lib/types/database.ts` (regenerated)

- [ ] **Step 1: Write the migration**

`supabase/migrations/0050_support_bookings.sql`:

```sql
-- Paid support bookings (phase 2 of the support gate). Prices are data;
-- a booking is confirmed ONLY by a verified Paystack payment (webhook or
-- server-side verify) — never by the browser redirect.
create table public.support_services (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key in ('remote','onsite')),
  name        text not null,
  price_cents int  not null check (price_cents > 0),
  active      boolean not null default true
);

insert into public.support_services (key, name, price_cents) values
  ('remote', 'Remote support session', 100000),
  ('onsite', 'Onsite callout',         125000);

create table public.support_bookings (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients(id) on delete cascade,
  service_id         uuid not null references public.support_services(id),
  slot_start         timestamptz not null,
  slot_end           timestamptz not null,
  amount_cents       int not null,
  vat_cents          int not null,
  paystack_reference text not null unique,
  status             text not null default 'pending_payment'
                       check (status in ('pending_payment','paid','completed','cancelled')),
  booked_by          uuid references public.profiles(id) on delete set null,
  freescout_number   int,
  note               text,
  created_at         timestamptz not null default now(),
  paid_at            timestamptz
);
create index support_bookings_slot_idx on public.support_bookings (slot_start);
create index support_bookings_client_idx on public.support_bookings (client_id);

alter table public.support_services enable row level security;
alter table public.support_bookings enable row level security;

create policy support_services_read on public.support_services
  for select to authenticated using (true);
create policy support_services_staff on public.support_services
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Clients: see and create their own; NO update/delete (status transitions
-- happen server-side via the service client after payment verification).
create policy support_bookings_staff on public.support_bookings
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy support_bookings_client_read on public.support_bookings
  for select using (client_id = public.current_client_id());
create policy support_bookings_client_insert on public.support_bookings
  for insert with check (client_id = public.current_client_id() and status = 'pending_payment');
```

- [ ] **Step 2: Push (verify ref first)** — `cat supabase/.temp/project-ref` → `eskhokedsximnslgsycs`, then `npx supabase db push --linked` → "Applying migration 0050_support_bookings.sql... Finished".

- [ ] **Step 3: Regen types + typecheck** — `npx supabase gen types typescript --linked > lib/types/database.ts && npx tsc --noEmit` → `support_bookings`/`support_services` present, clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0050_support_bookings.sql lib/types/database.ts
git commit -m "feat(bookings): services + bookings tables, seeds, RLS"
```

---

### Task 4: View layer + booking actions

**Files:**
- Create: `lib/views/bookings.ts`
- Create: `lib/actions/bookings.ts`

**Interfaces:**
- Views: `type BookingService = { id: string; key: string; name: string; priceCents: number }`; `getActiveServices(): Promise<BookingService[]>`; `getOpenSlots(): Promise<{ iso: string; label: string }[]>` (service-client blockers, times only); `type Booking = { id: string; serviceName: string; slotStart: string; slotLabel: string; amountCents: number; vatCents: number; status: string; reference: string; note: string | null; freescoutNumber: number | null; clientName?: string }`; `getBooking(id: string): Promise<Booking | null>` (RLS); `getClientBookings(): Promise<Booking[]>` (RLS, newest first); `getAllBookings(limit?: number): Promise<Booking[]>` (staff page).
- Actions: `type CreateBookingResult = { ok: true; url: string } | { ok: false; error: string }`; `createBooking(_prev: CreateBookingResult | null, formData: FormData): Promise<CreateBookingResult>` (fields `service_id`, `slot_iso`, `note`); `markBookingCompleted(id: string)`, `cancelBooking(id: string)` (staff); `saveServicePrice(formData)` (staff; fields `id`, `price_rands`).

- [ ] **Step 1: Write the view layer**

`lib/views/bookings.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { openSlots, type SlotBlocker } from "@/lib/booking-helpers";

export type BookingService = { id: string; key: string; name: string; priceCents: number };

export type Booking = {
  id: string;
  serviceName: string;
  slotStart: string;
  slotLabel: string;
  amountCents: number;
  vatCents: number;
  status: string;
  reference: string;
  note: string | null;
  freescoutNumber: number | null;
  clientName?: string;
};

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 27 Jul, 08:00" in SAST (fixed UTC+2) for a stored UTC slot. */
export function slotLabel(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 2 * 3_600_000);
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}, ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}

export async function getActiveServices(): Promise<BookingService[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_services")
    .select("id, key, name, price_cents")
    .eq("active", true)
    .order("key");
  return (data ?? []).map((s) => ({ id: s.id, key: s.key, name: s.name, priceCents: s.price_cents }));
}

/** Open slots for the next 10 business days. Availability must see EVERY
 *  client's bookings (capacity is global), which client RLS forbids — so
 *  this uses the service client but exposes only slot times. */
export async function getOpenSlots(): Promise<{ iso: string; label: string }[]> {
  const service = createServiceClient();
  const { data } = await service
    .from("support_bookings")
    .select("slot_start, status, created_at")
    .gte("slot_start", new Date().toISOString());
  return openSlots({ now: new Date(), businessDays: 10, blockers: (data ?? []) as SlotBlocker[] });
}

type BookingRow = {
  id: string;
  slot_start: string;
  amount_cents: number;
  vat_cents: number;
  status: string;
  paystack_reference: string;
  note: string | null;
  freescout_number: number | null;
  support_services: { name: string } | null;
  clients?: { name: string } | null;
};

const toBooking = (b: BookingRow): Booking => ({
  id: b.id,
  serviceName: b.support_services?.name ?? "Support session",
  slotStart: b.slot_start,
  slotLabel: slotLabel(b.slot_start),
  amountCents: b.amount_cents,
  vatCents: b.vat_cents,
  status: b.status,
  reference: b.paystack_reference,
  note: b.note,
  freescoutNumber: b.freescout_number,
  clientName: b.clients?.name,
});

const SELECT = "id, slot_start, amount_cents, vat_cents, status, paystack_reference, note, freescout_number, support_services(name)";

export async function getBooking(id: string): Promise<Booking | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("support_bookings").select(SELECT).eq("id", id).maybeSingle();
  return data ? toBooking(data as unknown as BookingRow) : null;
}

export async function getClientBookings(): Promise<Booking[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_bookings")
    .select(SELECT)
    .order("slot_start", { ascending: false })
    .limit(20);
  return (data ?? []).map((b) => toBooking(b as unknown as BookingRow));
}

/** Staff: all bookings, upcoming first, with the client name. */
export async function getAllBookings(limit = 30): Promise<Booking[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("support_bookings")
    .select(`${SELECT}, clients(name)`)
    .order("slot_start", { ascending: false })
    .limit(limit);
  return (data ?? []).map((b) => toBooking(b as unknown as BookingRow));
}
```

- [ ] **Step 2: Write the actions**

`lib/actions/bookings.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { slotTaken, totalCents, vatCents, type SlotBlocker } from "@/lib/booking-helpers";
import { initializeTransaction } from "@/lib/paystack";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

export type CreateBookingResult = { ok: true; url: string } | { ok: false; error: string };

/** Any portal user of a client books for their company. Slot re-check and
 *  hold-insert first; Paystack initialize second; a failed initialize
 *  releases the hold. Payment confirmation happens in the webhook/verify. */
export async function createBooking(
  _prev: CreateBookingResult | null,
  formData: FormData,
): Promise<CreateBookingResult> {
  const me = await getCurrentProfile();
  if (!me.authenticated || !me.profile.client_id) return { ok: false, error: "Sign in to book." };
  const serviceId = String(formData.get("service_id") ?? "");
  const slotIso = String(formData.get("slot_iso") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!serviceId || !slotIso || isNaN(Date.parse(slotIso))) return { ok: false, error: "Pick a service and a slot." };

  const service = createServiceClient();
  const { data: svc } = await service
    .from("support_services")
    .select("id, name, price_cents, active")
    .eq("id", serviceId)
    .maybeSingle();
  if (!svc?.active) return { ok: false, error: "That service isn't available." };

  // Re-check the slot against ALL clients' bookings (global capacity).
  const { data: blockers } = await service
    .from("support_bookings")
    .select("slot_start, status, created_at")
    .eq("slot_start", slotIso);
  if (slotTaken(slotIso, (blockers ?? []) as SlotBlocker[], new Date())) {
    return { ok: false, error: "That slot was just taken — pick another." };
  }

  const reference = `bk_${crypto.randomUUID()}`;
  const slotEnd = new Date(Date.parse(slotIso) + 3_600_000).toISOString();
  const supabase = await createClient(); // RLS: insert allowed for own client, pending only
  const { data: booking, error: insErr } = await supabase
    .from("support_bookings")
    .insert({
      client_id: me.profile.client_id,
      service_id: svc.id,
      slot_start: slotIso,
      slot_end: slotEnd,
      amount_cents: svc.price_cents,
      vat_cents: vatCents(svc.price_cents),
      paystack_reference: reference,
      booked_by: me.profile.id,
      note,
    })
    .select("id")
    .single();
  if (insErr || !booking) return { ok: false, error: "Couldn't hold that slot — try again." };

  try {
    const url = await initializeTransaction({
      email: me.profile.email,
      amountCents: totalCents(svc.price_cents),
      reference,
      callbackUrl: `${APP_URL}/support/bookings/${booking.id}`,
    });
    revalidatePath("/support");
    return { ok: true, url };
  } catch (e) {
    await service.from("support_bookings").delete().eq("id", booking.id); // release the hold
    console.error("paystack initialize failed:", e);
    return { ok: false, error: "Payment couldn't be started — nothing was booked. Try again shortly." };
  }
}

export async function markBookingCompleted(id: string) {
  await staff();
  const service = createServiceClient();
  await service.from("support_bookings").update({ status: "completed" }).eq("id", id).eq("status", "paid");
  revalidatePath("/admin/support-packages");
}

export async function cancelBooking(id: string) {
  await staff();
  const service = createServiceClient();
  await service
    .from("support_bookings")
    .update({ status: "cancelled" })
    .eq("id", id)
    .in("status", ["pending_payment", "paid"]);
  revalidatePath("/admin/support-packages");
  revalidatePath("/support");
}

export async function saveServicePrice(formData: FormData) {
  await staff();
  const id = String(formData.get("id") ?? "");
  const rands = Number(formData.get("price_rands"));
  if (!id || !Number.isFinite(rands) || rands <= 0) throw new Error("invalid price");
  const supabase = await createClient();
  const { error } = await supabase
    .from("support_services")
    .update({ price_cents: Math.round(rands * 100) })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/support-packages");
  revalidatePath("/support");
}
```

- [ ] **Step 3: Typecheck + suite** — `npx tsc --noEmit && npm test` → clean/green.

- [ ] **Step 4: Commit**

```bash
git add lib/views/bookings.ts lib/actions/bookings.ts
git commit -m "feat(bookings): view layer + booking/price actions"
```

---

### Task 5: Confirmation core + webhook route + email

**Files:**
- Create: `lib/booking-confirm.ts`
- Create: `app/api/paystack/webhook/route.ts`
- Modify: `lib/notify.ts` (add exported `sendBookingConfirmation`)

**Interfaces:**
- `confirmBooking(reference: string, amountPaidCents: number): Promise<"confirmed" | "already" | "not_found" | "underpaid">` — idempotent; called by the webhook AND the booking page fallback (Task 6).
- `sendBookingConfirmation(opts: { to: string; serviceName: string; slotLabel: string; totalCents: number; reference: string; clientId: string | null }): Promise<void>`

- [ ] **Step 1: Add the email to `lib/notify.ts`**

Append (uses the existing private `sendEmail` and `SUPPORT_EMAIL`; match existing file idioms):

```ts
export async function sendBookingConfirmation(opts: {
  to: string;
  serviceName: string;
  slotLabel: string;
  totalCents: number;
  reference: string;
  clientId: string | null;
}): Promise<void> {
  const rands = `R ${(opts.totalCents / 100).toFixed(2).replace(".", ",")}`;
  await sendEmail({
    to: opts.to,
    subject: `Booking confirmed — ${opts.serviceName}, ${opts.slotLabel}`,
    replyTo: SUPPORT_EMAIL,
    category: "booking",
    clientId: opts.clientId,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1a1a;">
        <h2 style="margin:0 0 8px;">You're booked in</h2>
        <p style="color:#444;margin:0 0 16px;">
          Your <strong>${opts.serviceName}</strong> is confirmed for <strong>${opts.slotLabel}</strong>.
          Paid: <strong>${rands}</strong> (ref ${opts.reference}).
        </p>
        <p style="color:#444;margin:0 0 16px;">
          One of our engineers will be in touch at the booked time. Need to reschedule?
          Just reply to this email and we'll sort it out.
        </p>
        <p style="color:#888;margin:16px 0 0;font-size:13px;">&mdash; The Rocking team</p>
      </div>`,
  });
}
```

(If `SUPPORT_EMAIL` isn't already a module-level constant in notify.ts, use the existing one — it is; check imports before adding.)

- [ ] **Step 2: Write the confirmation core**

`lib/booking-confirm.ts`:

```ts
import { createServiceClient } from "@/lib/supabase/service";
import { createTicket } from "@/lib/freescout";
import { sendBookingConfirmation } from "@/lib/notify";
import { slotLabel } from "@/lib/views/bookings";

/** Flip a booking to paid once payment is verified. Idempotent — the webhook
 *  and the booking page's verify fallback can both call this safely. The
 *  paid-flip is the critical write; FreeScout/email failures must not undo it. */
export async function confirmBooking(
  reference: string,
  amountPaidCents: number,
): Promise<"confirmed" | "already" | "not_found" | "underpaid"> {
  const service = createServiceClient();
  const { data: b } = await service
    .from("support_bookings")
    .select(
      "id, client_id, slot_start, amount_cents, vat_cents, status, note, booked_by, support_services(key, name), clients(name)",
    )
    .eq("paystack_reference", reference)
    .maybeSingle();
  if (!b) return "not_found";
  if (b.status !== "pending_payment") return "already";
  const due = b.amount_cents + b.vat_cents;
  if (amountPaidCents < due) {
    console.error(`booking ${b.id}: paid ${amountPaidCents} < due ${due}`);
    return "underpaid";
  }

  const { error } = await service
    .from("support_bookings")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", b.id)
    .eq("status", "pending_payment");
  if (error) throw new Error(error.message);

  // Side-effects are best-effort — never let them look like payment failure.
  const svc = b.support_services as unknown as { key: string; name: string } | null;
  const clientName = (b.clients as unknown as { name: string } | null)?.name ?? "client";
  const label = slotLabel(b.slot_start);
  try {
    const { data: booker } = await service.from("profiles").select("email, client_id").eq("id", b.booked_by).maybeSingle();
    const email = booker?.email;
    if (email) {
      const { data: pkgRow } = await service
        .from("clients")
        .select("support_package_id, support_packages(key)")
        .eq("id", b.client_id)
        .maybeSingle();
      const tierKey = (pkgRow?.support_packages as unknown as { key: string } | null)?.key ?? "free";
      const ticketId = await createTicket({
        email,
        subject: `Paid ${svc?.name ?? "support session"}: ${label} — ${clientName}`,
        message: `Paid booking confirmed (ref ${reference}).\n\nService: ${svc?.name}\nSlot: ${label}\nClient: ${clientName}\n\nClient's note:\n${b.note ?? "—"}`,
        tags: ["booking", `tier:${tierKey}`],
      });
      await service.from("support_bookings").update({ freescout_number: ticketId }).eq("id", b.id);
      await sendBookingConfirmation({
        to: email,
        serviceName: svc?.name ?? "Support session",
        slotLabel: label,
        totalCents: due,
        reference,
        clientId: b.client_id,
      });
    }
  } catch (e) {
    console.error("booking side-effects failed (payment is recorded):", e);
  }
  return "confirmed";
}
```

- [ ] **Step 3: Write the webhook route**

`app/api/paystack/webhook/route.ts`:

```ts
import { NextResponse } from "next/server";
import { verifyPaystackSignature } from "@/lib/paystack-signature";
import { paystackSecret } from "@/lib/paystack";
import { confirmBooking } from "@/lib/booking-confirm";

/** Paystack webhook. The signature check is the authentication — anyone can
 *  POST here, but only Paystack can sign with our secret key. Always 200 on
 *  handled events (Paystack retries non-2xx). */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-paystack-signature");
  if (!verifyPaystackSignature(raw, signature, paystackSecret())) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: { event?: string; data?: { reference?: string; amount?: number } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  if (event.event === "charge.success" && event.data?.reference) {
    const result = await confirmBooking(event.data.reference, Number(event.data.amount ?? 0));
    // not_found is fine (non-booking payments); underpaid is logged inside.
    return NextResponse.json({ handled: result });
  }
  return NextResponse.json({ ignored: event.event ?? "unknown" });
}
```

- [ ] **Step 4: Typecheck + suite + build** — `npx tsc --noEmit && npm test && npm run build` → clean; route `/api/paystack/webhook` appears in the build output.

- [ ] **Step 5: Commit**

```bash
git add lib/booking-confirm.ts app/api/paystack/webhook/route.ts lib/notify.ts
git commit -m "feat(bookings): idempotent confirmation core + signed webhook + email"
```

---

### Task 6: Client UI — book, pay, status

**Files:**
- Create: `components/BookSession.tsx` (client component)
- Create: `app/(app)/support/bookings/[id]/page.tsx`
- Modify: `app/(app)/support/page.tsx` (Book-a-session card + bookings list)

**Interfaces:**
- Consumes: `getActiveServices`, `getOpenSlots`, `getClientBookings`, `getBooking` (Task 4 views); `createBooking` (Task 4); `verifyTransaction` (Task 2); `confirmBooking` (Task 5); `fmtRands`, `totalCents` (Task 1).

- [ ] **Step 1: Write the booking form**

`components/BookSession.tsx`:

```tsx
"use client";

import { useActionState, useMemo, useState } from "react";
import { createBooking, type CreateBookingResult } from "@/lib/actions/bookings";
import { fmtRands, totalCents } from "@/lib/booking-helpers";
import type { BookingService } from "@/lib/views/bookings";

const FIELD =
  "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

export function BookSession({
  services,
  slots,
}: {
  services: BookingService[];
  slots: { iso: string; label: string }[];
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [state, formAction, pending] = useActionState<CreateBookingResult | null, FormData>(
    async (prev, fd) => {
      const result = await createBooking(prev, fd);
      if (result.ok) window.location.href = result.url; // off to Paystack
      return result;
    },
    null,
  );
  const selected = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId]);
  const days = useMemo(() => [...new Set(slots.map((s) => s.label.split(",")[0]))], [slots]);
  const [day, setDay] = useState<string>("");
  const daySlots = slots.filter((s) => s.label.startsWith(day ? `${day},` : ""));

  return (
    <form action={formAction} className="space-y-3 px-4 py-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <select name="service_id" value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={FIELD}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {fmtRands(totalCents(s.priceCents))} incl VAT
            </option>
          ))}
        </select>
        <select value={day} onChange={(e) => setDay(e.target.value)} className={FIELD}>
          <option value="">Pick a day…</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select name="slot_iso" required defaultValue="" className={FIELD} disabled={!day}>
          <option value="" disabled>
            Time…
          </option>
          {daySlots.map((s) => (
            <option key={s.iso} value={s.iso}>
              {s.label.split(", ")[1]}
            </option>
          ))}
        </select>
      </div>
      <input name="note" placeholder="What do you need help with? (optional)" className={`${FIELD} w-full`} />
      <div className="flex items-center gap-3">
        <button
          disabled={pending || !day}
          className="rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
        >
          {pending ? "Starting payment…" : `Book & pay ${selected ? fmtRands(totalCents(selected.priceCents)) : ""}`}
        </button>
        <span className="text-xs text-muted">You'll pay securely on Paystack; the slot is confirmed once payment goes through.</span>
      </div>
      {state && !state.ok && <p className="text-xs text-brand">{state.error}</p>}
    </form>
  );
}
```

- [ ] **Step 2: Add the card + list to `app/(app)/support/page.tsx`**

Imports to add:

```tsx
import { BookSession } from "@/components/BookSession";
import { getActiveServices, getOpenSlots, getClientBookings } from "@/lib/views/bookings";
import { fmtRands } from "@/lib/booking-helpers";
```

Inside the component, fetch alongside the existing calls (before the return):

```tsx
  const [services, slots, bookings] = await Promise.all([
    getActiveServices(),
    getOpenSlots(),
    getClientBookings(),
  ]);
```

Render after the tickets card, before the closing `</div>`:

```tsx
      <Card>
        <CardHeader title="Book a session" />
        <p className="border-b border-line-soft px-4 pb-3 pt-3.5 text-[13px] text-muted">
          Need hands-on help — remote or at your office? Book a one-hour slot and pay online; weekdays 08:00–17:00.
        </p>
        <BookSession services={services} slots={slots} />
      </Card>

      {bookings.length > 0 && (
        <Card>
          <CardHeader title="Your bookings" count={bookings.length} />
          {bookings.map((b) => (
            <Link
              key={b.id}
              href={`/support/bookings/${b.id}`}
              className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-0 hover:bg-canvas"
            >
              <StatusPill
                tone={b.status === "paid" || b.status === "completed" ? "good" : b.status === "cancelled" ? "bad" : "warn"}
                label={b.status === "pending_payment" ? "Awaiting payment" : b.status[0].toUpperCase() + b.status.slice(1)}
              />
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">
                  {b.serviceName} — {b.slotLabel}
                </div>
                <div className="truncate text-xs text-muted">{fmtRands(b.amountCents + b.vatCents)} incl VAT</div>
              </div>
            </Link>
          ))}
        </Card>
      )}
```

- [ ] **Step 3: Write the booking status page**

`app/(app)/support/bookings/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { getBooking } from "@/lib/views/bookings";
import { verifyTransaction } from "@/lib/paystack";
import { confirmBooking } from "@/lib/booking-confirm";
import { fmtRands } from "@/lib/booking-helpers";
import { Card, PageHeader, StatusPill } from "@/components/ui";

/** Booking status. If the client lands here from Paystack before the webhook
 *  arrives, the server-side verify fallback confirms the payment — the page
 *  never trusts the redirect itself. */
export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let booking = await getBooking(id);

  if (booking?.status === "pending_payment") {
    try {
      const check = await verifyTransaction(booking.reference);
      if (check.paid) {
        await confirmBooking(booking.reference, check.amountCents);
        booking = await getBooking(id);
      }
    } catch {
      // verify is best-effort; the webhook remains the primary path
    }
  }

  if (!booking) {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumb={<Link href="/support" className="hover:text-ink">← Back to support</Link>}
          title="Booking not found"
        />
      </div>
    );
  }

  const paid = booking.status === "paid" || booking.status === "completed";
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<Link href="/support" className="hover:text-ink">← Back to support</Link>}
        title={booking.serviceName}
        subtitle={booking.slotLabel}
      />
      <Card>
        <div className="space-y-3 px-4 py-4">
          <StatusPill
            tone={paid ? "good" : booking.status === "cancelled" ? "bad" : "warn"}
            label={
              booking.status === "pending_payment"
                ? "Awaiting payment"
                : booking.status[0].toUpperCase() + booking.status.slice(1)
            }
          />
          <p className="text-sm text-ink-2">
            {fmtRands(booking.amountCents + booking.vatCents)} incl VAT · ref {booking.reference}
          </p>
          {paid ? (
            <p className="text-sm text-muted">
              You&apos;re booked in — one of our engineers will be in touch at the booked time. Need to reschedule?
              Reply to your confirmation email or raise a ticket and we&apos;ll sort it out.
            </p>
          ) : booking.status === "pending_payment" ? (
            <p className="text-sm text-muted">
              This slot is held for 30 minutes while payment completes. If you closed the payment page, head back to
              Support and book again.
            </p>
          ) : (
            <p className="text-sm text-muted">This booking was cancelled. If that&apos;s unexpected, raise a ticket.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Build + suite** — `npm test && npm run build` → green/clean; both new routes listed.

- [ ] **Step 5: Commit**

```bash
git add components/BookSession.tsx "app/(app)/support/bookings/[id]/page.tsx" "app/(app)/support/page.tsx"
git commit -m "feat(bookings): book-and-pay flow + booking status page"
```

---

### Task 7: Admin — bookings list + service prices

**Files:**
- Modify: `app/(admin)/admin/support-packages/page.tsx`

- [ ] **Step 1: Add imports**

```tsx
import { getAllBookings } from "@/lib/views/bookings";
import { getActiveServices } from "@/lib/views/bookings";
import { saveServicePrice, markBookingCompleted, cancelBooking } from "@/lib/actions/bookings";
import { fmtRands } from "@/lib/booking-helpers";
```

(Consolidate into one import from `@/lib/views/bookings`.)

- [ ] **Step 2: Fetch alongside existing data**

Add to the existing `Promise.all`: `getActiveServices()` and `getAllBookings()` (extend the destructuring to `services` and `bookings`).

- [ ] **Step 3: Render two new cards** (after the "This month" card)

```tsx
      <Card>
        <CardHeader title="Paid session prices" count={services.length} />
        {services.map((s) => (
          <form key={s.id} action={saveServicePrice} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5 last:border-0">
            <input type="hidden" name="id" value={s.id} />
            <span className="w-48 text-sm font-medium text-ink">{s.name}</span>
            <label className="flex items-center gap-1.5 text-[13px] text-ink-2">
              R
              <input name="price_rands" type="number" min="1" step="50" defaultValue={s.priceCents / 100} className={`${FIELD} w-28`} />
              ex VAT / hour
            </label>
            <span className="text-xs text-muted">({fmtRands(Math.round(s.priceCents * 1.15))} incl)</span>
            <button className="ml-auto rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
              Save
            </button>
          </form>
        ))}
      </Card>

      <Card>
        <CardHeader title="Bookings" count={bookings.length} />
        {bookings.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted">No bookings yet.</p>
        ) : (
          <ul>
            {bookings.map((b) => {
              const complete = markBookingCompleted.bind(null, b.id);
              const cancel = cancelBooking.bind(null, b.id);
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-2.5 border-b border-line-soft px-4 py-3 last:border-0">
                  <span className="shrink-0 rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium capitalize text-ink-3">
                    {b.status === "pending_payment" ? "pending" : b.status}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {b.clientName ?? "—"} · {b.serviceName} · {b.slotLabel}
                    </p>
                    <p className="text-xs text-faint">
                      {fmtRands(b.amountCents + b.vatCents)} incl
                      {b.freescoutNumber ? ` · ticket #${b.freescoutNumber}` : ""}
                      {b.note ? ` · ${b.note}` : ""}
                    </p>
                  </div>
                  {b.status === "paid" && (
                    <form action={complete}>
                      <button className="text-xs font-semibold text-good">Mark completed</button>
                    </form>
                  )}
                  {(b.status === "paid" || b.status === "pending_payment") && (
                    <form action={cancel}>
                      <button className="text-xs text-faint hover:text-brand" title="Cancel (refunds are manual — Paystack dashboard)">
                        Cancel
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
```

Note: `text-good` exists in the token set (used by status tones); if the class isn't present, use `text-ink-2`.

- [ ] **Step 4: Build** — `npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/support-packages/page.tsx"
git commit -m "feat(bookings): admin bookings list + service price editing"
```

---

### Task 8: End-to-end verification (test mode) + ship

- [ ] **Step 1:** `npm test && npm run build` — all green.
- [ ] **Step 2: Test-mode checkout, locally.** Add `PAYSTACK_USE_TEST=1` to `.env.local`, `npm run dev`, sign in as staff-impersonated client user (or a real test manager), book a slot → redirected to Paystack test checkout → pay with Paystack's test card (4084 0840 8408 4081, any future expiry, any CVV, OTP 123456) → land back on the booking page → verify fallback flips it to **paid** (webhook can't reach localhost — that's the fallback path working). Confirm: FreeScout ticket created with `booking` + `tier:` tags; confirmation email received; booking shows paid on /support; slot no longer offered.
- [ ] **Step 3: Slot contention.** Start a second booking for the same slot in another session → must be told the slot is taken while the first hold is fresh.
- [ ] **Step 4: Webhook signature.** `curl -X POST localhost:3000/api/paystack/webhook -d '{}'` → 401. (Signed-path correctness is covered by unit tests + step 5.)
- [ ] **Step 5: Ship + wire the live webhook.** Remove `PAYSTACK_USE_TEST` from prod concerns (it's absent in Vercel), `git push origin main`, wait for deploy, then Shawn pastes `https://portal.rocking.one/api/paystack/webhook` into Paystack → Live Webhook URL. Optional: repeat one real R-something booking end-to-end in live mode and manually refund it via the Paystack dashboard.
- [ ] **Step 6:** RLS spot-check in prod: client A cannot read client B's bookings; anon reads nothing; anon POST to webhook → 401.
