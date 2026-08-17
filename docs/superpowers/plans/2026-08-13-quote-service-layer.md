# Quote Service Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give quote create / amend / send a single owner (`lib/quotes/service.ts`) so the team and Hermes can draft quotes without being able to email a client.

**Architecture:** Two stages. First, extract the duplicated primitives (email delivery, booking link) into marker-free modules that both Next.js and a plain Node script can import, then delete the script's private copies. Second, add a policy-only service that enforces the actor model, the review gate, and idempotent creation.

**Tech Stack:** TypeScript, Next.js 15 (App Router, server actions), Supabase (Postgres + RLS), Resend, Vitest, Node 22 native type-stripping.

**Spec:** `docs/superpowers/specs/2026-08-13-quote-service-layer-design.md`

## Global Constraints

- **Supabase project ref is `eskhokedsximnslgsycs`.** Never any other project. Migrations run with `supabase db push` (no `--project-ref` flag; the repo is linked).
- **Never print or commit `.env.local` contents or any credential value.**
- **Shared modules must be importable by plain Node:** no `import "server-only"`, no `@/…` path aliases, relative imports only, dependencies injected as parameters. Verified blockers: `server-only` fails to resolve; Node has no tsconfig path resolution.
- **Money is handled as it is today:** quote documents use rands as decimal numbers; `computeTotals` in `lib/quotes/doc.ts` is the single source of truth for totals. Do not reimplement it.
- **Quote email must send from `"Rocky @ Rocking" <quotes@send.rocking.one>`** — it is the inbound-reply address and changing it breaks reply threading.
- **`accounts@rocking.one` is CC'd on all quote-related email**, alongside `shawn@rocking.one`.
- **Only `sendQuote` may set status `sent`.** `create` and `amend` produce `draft` or `pending_review`.
- After each migration run `supabase gen types typescript --linked > lib/types/database.ts`.
- Run the full suite with `npx vitest run` before each commit. It must stay green (506 tests at time of writing).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `lib/email/deliver.ts` | **New.** Marker-free Resend send + `sent_emails` record. Takes `(sb, opts)`. |
| `lib/email/send.ts` | **Modify.** Keeps `server-only`; becomes a thin wrapper that injects `createServiceClient()` into `deliver`. |
| `lib/quotes/booking-link.ts` | **New.** Marker-free single-use Calendly link minting. Takes `(sb, quoteId)`. |
| `lib/quote-emails.ts` | **Modify.** Delegates its private `ensureBookingLink` to the new module. |
| `scripts/create-quote.mjs` | **Modify.** Deletes four private copies; imports the shared modules. |
| `supabase/migrations/0089_quote_service_layer.sql` | **New.** Idempotency key, client prefix, prefix counters, seeding. |
| `lib/quotes/policy.ts` | **New.** Pure decision functions. No I/O. |
| `lib/quotes/policy.test.ts` | **New.** Exhaustive unit tests for the policy. |
| `lib/quotes/service.ts` | **New.** `makeQuoteService(sb)` → create / amend / send. |
| `app/(admin)/admin/quotes/actions.ts` | **Modify.** `approveAndSendQuote` delegates to `service.send`. |

---

## Task 1: Extract the email delivery core

**Files:**
- Create: `lib/email/deliver.ts`
- Modify: `lib/email/send.ts`
- Test: `lib/email/deliver.test.ts`

**Interfaces:**
- Consumes: `isSuppressible`, `splitRecipients` from `./suppression.ts` (already marker-free).
- Produces: `deliverEmail(sb, opts: DeliverOptions): Promise<{ id: string | null; suppressed: string[] }>` where `DeliverOptions` has the same fields as today's `SendEmailOptions`.

- [ ] **Step 1: Read the current implementation end to end**

Read `lib/email/send.ts` in full. The logic to move: suppression filtering, the Resend POST, the `sent_emails` insert (using `recordHtml ?? html`), and the footer append. Note exactly which fields go into `sent_emails`.

- [ ] **Step 2: Write the failing test**

```ts
// lib/email/deliver.test.ts
import { describe, expect, it, vi } from "vitest";
import { deliverEmail } from "./deliver.ts";

function stubSb(captured: { row?: Record<string, unknown> }) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }),
      insert: async (row: Record<string, unknown>) => { captured.row = row; return { error: null }; },
    }),
  } as never;
}

describe("deliverEmail", () => {
  it("records the sent email with recordHtml, never the live html", async () => {
    const captured: { row?: Record<string, unknown> } = {};
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    const res = await deliverEmail(stubSb(captured), {
      to: ["a@b.com"], subject: "Hi", html: "<a href='SECRET'>go</a>",
      recordHtml: "<a href='/login'>go</a>", category: "onboarding", clientId: null,
    });
    expect(res.id).toBe("abc");
    expect(captured.row?.html).toBe("<a href='/login'>go</a>");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npx vitest run lib/email/deliver.test.ts`
Expected: FAIL — `Cannot find module './deliver.ts'`.

- [ ] **Step 4: Create `lib/email/deliver.ts`**

Move the body of today's `sendEmail` into it. Requirements:
- No `import "server-only"`.
- No `@/` imports — use `./suppression.ts` and `./portal-update-footer.ts`.
- First parameter is the Supabase client; never call `createServiceClient()` inside.
- Export `type DeliverOptions` with exactly the fields `SendEmailOptions` has today.
- Preserve every existing behaviour: suppression allow-list, `recordHtml ?? html` when recording, bcc never recorded, `id: null` when `RESEND_API_KEY` is missing, and a logging failure never propagating.

- [ ] **Step 5: Run the test**

Run: `npx vitest run lib/email/deliver.test.ts`
Expected: PASS.

- [ ] **Step 6: Rewire `send.ts` as a wrapper**

```ts
import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { deliverEmail, type DeliverOptions } from "./deliver.ts";

export const DEFAULT_FROM = '"Rocking" <no-reply@send.rocking.one>';
export type SendEmailOptions = DeliverOptions;

export async function sendEmail(opts: SendEmailOptions) {
  return deliverEmail(createServiceClient(), opts);
}
```

Keep the existing file-top comment about this being the one door every portal email goes through.

- [ ] **Step 7: Verify nothing else broke**

Run: `npx vitest run` — expected: all pass.
Run: `npx tsc --noEmit 2>&1 | grep -v "lib/views/status\|app/(app)/layout\|lib/actions/status\|.next/types"` — expected: no output. (Those four are pre-existing failures from other work; ignore them.)

- [ ] **Step 8: Prove a plain Node script can import it**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && node -e '
import("./lib/email/deliver.ts").then(m => console.log("OK:", Object.keys(m).join(", ")))
' 2>/dev/null
```
Expected: `OK: deliverEmail` (type exports do not appear at runtime). If this fails, a `server-only` or `@/` import survived.

- [ ] **Step 9: Commit**

```bash
git add lib/email/deliver.ts lib/email/deliver.test.ts lib/email/send.ts
git commit -m "refactor(email): extract marker-free delivery core so scripts can share it"
```

---

## Task 2: Extract the booking-link module

**Files:**
- Create: `lib/quotes/booking-link.ts`
- Modify: `lib/quote-emails.ts:93-108` (the private `ensureBookingLink`)
- Test: `lib/quotes/booking-link.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ensureQuoteBookingLink(sb, quoteId: string): Promise<string | null>` and `isBookingLinkStale(createdAt: string | null): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// lib/quotes/booking-link.test.ts
import { describe, expect, it } from "vitest";
import { isBookingLinkStale } from "./booking-link.ts";

describe("isBookingLinkStale", () => {
  it("treats a link with no timestamp as stale", () => {
    expect(isBookingLinkStale(null)).toBe(true);
  });
  it("treats a link older than 90 days as stale", () => {
    const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000).toISOString();
    expect(isBookingLinkStale(old)).toBe(true);
  });
  it("treats a fresh link as usable", () => {
    const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(isBookingLinkStale(recent)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/quotes/booking-link.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `lib/quotes/booking-link.ts`**

Move `isBookingLinkStale`, `LINK_TTL_DAYS`, `QUOTE_HOST_TOKEN_ENV`, `QUOTE_EVENT_TYPE_URI` and `createSingleUseBookingLink` out of `lib/calendly.ts`, plus the `ensureBookingLink` body from `lib/quote-emails.ts:93-108`. Requirements:
- No `server-only`, no `@/` imports.
- `ensureQuoteBookingLink(sb, quoteId)` reads `booking_url` / `booking_link_created_at`, returns the existing link when fresh, otherwise mints one and stores it.
- Never throws: a Calendly outage must not stop a quote sending. Return the existing value (or null) and `console.error`.
- Keep the comment explaining that Calendly caps `max_event_count` at 1 and the link therefore belongs to the quote, not the recipient.

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/quotes/booking-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Point `lib/calendly.ts` and `lib/quote-emails.ts` at it**

`lib/calendly.ts` keeps `import "server-only"` and re-exports for existing callers:

```ts
export { isBookingLinkStale, createSingleUseBookingLink, LINK_TTL_DAYS, QUOTE_HOST_TOKEN_ENV, QUOTE_EVENT_TYPE_URI } from "./quotes/booking-link.ts";
```

In `lib/quote-emails.ts`, delete the private `ensureBookingLink` and call `ensureQuoteBookingLink(createServiceClient(), opts.quoteId)` instead.

- [ ] **Step 6: Verify**

Run: `npx vitest run` — all pass.
Run: `npx tsc --noEmit 2>&1 | grep -v "lib/views/status\|app/(app)/layout\|lib/actions/status\|.next/types"` — no output.
Run: `node -e 'import("./lib/quotes/booking-link.ts").then(m => console.log("OK:", Object.keys(m).join(", ")))' 2>/dev/null` — prints the exports.

- [ ] **Step 7: Commit**

```bash
git add lib/quotes/booking-link.ts lib/quotes/booking-link.test.ts lib/calendly.ts lib/quote-emails.ts
git commit -m "refactor(quotes): extract marker-free booking-link module"
```

---

## Task 3: De-duplicate `create-quote.mjs`

**Files:**
- Modify: `scripts/create-quote.mjs` (delete lines around 46, 160, 207, 236-310 — verify against the file, do not trust these numbers blindly)

**Interfaces:**
- Consumes: `computeTotals` from `lib/quotes/doc.ts`; `deliverEmail` from `lib/email/deliver.ts`; `ensureQuoteBookingLink` from `lib/quotes/booking-link.ts`.
- Produces: no new exports. Behaviour must be **identical**.

- [ ] **Step 1: Capture a before-baseline**

Create a throwaway quote from an existing fixture with `--no-email`, then dump what was stored:

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2
node scripts/create-quote.mjs scripts/qu-dst-001.json --no-email > /tmp/before-stdout.txt 2>&1
```

The fixture has an explicit `"number": "QU-DST-001"` which already exists, so **first** copy it to `/tmp/baseline-quote.json` and change `"number"` to `"QU-ZZZ-901"` and `clientId` to any existing client. Record the created quote id from stdout, then write the stored `doc`, `subtotal`, `vat_amount`, `grand_total` and `monthly_total` to `/tmp/before.json` with a scratch script.

- [ ] **Step 2: Replace the private `computeTotals`**

Delete the copy at the top of the script and its "keep in sync" comment. Add:

```js
import { computeTotals } from "../lib/quotes/doc.ts";
```

`doc.ts` is pure and marker-free, so this needs no other change. Note its return shape is `{ sections, subtotal, vat, grand, monthly, revenueExVat }` — the script currently uses `subtotal`, `vat`, `grand`, `monthly`, which match.

- [ ] **Step 3: Replace the private booking-link minter**

Delete `async function ensureBookingLink(qid)` and the Calendly constants. Add:

```js
import { ensureQuoteBookingLink } from "../lib/quotes/booking-link.ts";
```

Replace the call site with `await ensureQuoteBookingLink(sb, quoteId)`.

- [ ] **Step 4: Replace both Resend `fetch` calls and the manual `sent_emails` insert**

Delete the `sent_emails` insert and its "kept in sync by hand" comment. Both send sites become:

```js
import { deliverEmail } from "../lib/email/deliver.ts";

const { id } = await deliverEmail(sb, {
  from: '"Rocky @ Rocking" <quotes@send.rocking.one>',
  to,
  cc: ["shawn@rocking.one", "accounts@rocking.one"],
  subject: `${heading}: ${title}`,
  html: clientHtml,
  clientId,
  category: "quote",
  audience: "client",
});
```

Keep the `resend_message_id` update on the `sent` event — `deliverEmail` returns the raw id and the caller formats the `<id@send.rocking.one>` header, exactly as `quote-emails.ts` does.

The pending-review branch keeps its own recipients (`shawn@`, `kelle@`, cc `accounts@`) and passes `audience: "internal"`.

- [ ] **Step 5: Capture the after-baseline and diff**

Run the same fixture again with a different number (`QU-ZZZ-902`), dump the same fields to `/tmp/after.json`, then:

```bash
diff <(jq -S . /tmp/before.json) <(jq -S . /tmp/after.json)
```

Expected: differences **only** in `quoteNumber` and ids. Any difference in `doc`, totals, or the email HTML means the extraction changed behaviour — stop and fix.

- [ ] **Step 6: Delete both scratch quotes**

Write a scratch script that deletes `quote_internal`, `quote_events`, `quote_versions` and `quotes` rows for `QU-ZZZ-901` and `QU-ZZZ-902`, in that order (children before parent). Confirm both are gone.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run` — all pass.

```bash
git add scripts/create-quote.mjs
git commit -m "refactor(quotes): create-quote.mjs shares the library instead of copying it"
```

---

## Task 4: Schema — idempotency and per-client numbering

**Files:**
- Create: `supabase/migrations/0089_quote_service_layer.sql`
- Modify: `lib/types/database.ts` (regenerated, not hand-edited)

**Interfaces:**
- Produces: `quotes.idempotency_key`, `clients.quote_prefix`, table `quote_prefix_counters`, function `next_quote_number(prefix text)`.

- [ ] **Step 1: Check the next migration number**

```bash
cd /Users/shawnjooste/Documents/Claude/dashboard-v2 && git pull --ff-only && ls supabase/migrations | tail -3
```

If `0089` is taken (concurrent sessions do collide in this repo), renumber to the next free one.

- [ ] **Step 2: Write the migration**

```sql
-- Quote service layer: idempotent creation and per-client numbering.

alter table public.quotes
  add column if not exists idempotency_key text;

create unique index if not exists quotes_idempotency_key_idx
  on public.quotes (idempotency_key)
  where idempotency_key is not null;

comment on column public.quotes.idempotency_key is
  'Caller-supplied key; a repeat returns the original quote instead of creating a second.';

alter table public.clients
  add column if not exists quote_prefix text;

create unique index if not exists clients_quote_prefix_idx
  on public.clients (quote_prefix)
  where quote_prefix is not null;

create table if not exists public.quote_prefix_counters (
  prefix text primary key,
  last_n  int not null default 0
);
alter table public.quote_prefix_counters enable row level security;
-- no policies: only the security-definer function below and the service role touch it

create or replace function public.next_quote_number(p_prefix text)
returns text
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into quote_prefix_counters (prefix, last_n) values (p_prefix, 1)
  on conflict (prefix) do update set last_n = quote_prefix_counters.last_n + 1
  returning last_n into n;
  return 'QU-' || p_prefix || '-' || lpad(n::text, 3, '0');
end $$;

revoke execute on function public.next_quote_number(text) from public, anon, authenticated;

-- Seed prefixes and counters from quotes already issued, so the first generated
-- number cannot collide with one a client already holds.
insert into public.quote_prefix_counters (prefix, last_n)
select substring(quote_number from 4 for 3) as prefix,
       max(substring(quote_number from 8)::int) as last_n
  from public.quotes
 where quote_number ~ '^QU-[A-Z]{3}-[0-9]{3}$'
 group by 1
on conflict (prefix) do update set last_n = greatest(quote_prefix_counters.last_n, excluded.last_n);

update public.clients c
   set quote_prefix = sub.prefix
  from (
    select distinct on (client_id) client_id, substring(quote_number from 4 for 3) as prefix
      from public.quotes
     where quote_number ~ '^QU-[A-Z]{3}-[0-9]{3}$'
     order by client_id, created_at
  ) sub
 where c.id = sub.client_id
   and c.quote_prefix is null;
```

- [ ] **Step 3: Push and regenerate types**

```bash
supabase db push
supabase gen types typescript --linked > lib/types/database.ts
grep -c "idempotency_key\|quote_prefix" lib/types/database.ts
```
Expected: a non-zero count.

- [ ] **Step 4: Verify the seeding did its job**

Write a scratch script that prints every row of `quote_prefix_counters` alongside, for each prefix, the highest existing `quote_number`. Assert the counter is greater than or equal to the highest issued number for every prefix. A counter lower than an issued number will mint a duplicate — treat that as a blocker.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0089_quote_service_layer.sql lib/types/database.ts
git commit -m "feat(quotes): idempotency key and per-client quote numbering"
```

---

## Task 5: The pure policy module

**Files:**
- Create: `lib/quotes/policy.ts`
- Test: `lib/quotes/policy.test.ts`

**Interfaces:**
- Produces:
```ts
export type Actor = { id: string | null; label: string; canSend: boolean };
export type QuoteStatus = "draft" | "pending_review" | "sent" | "accepted" | "rejected" | "changes_requested" | "expired";
export function decideCreateStatus(actor: Actor): "draft" | "pending_review";
export function decideAmendStatus(actor: Actor): "draft" | "pending_review";
export function canSendFrom(status: QuoteStatus): boolean;
export function canRetryDelivery(status: QuoteStatus, sentEventMessageId: string | null): boolean;
```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/quotes/policy.test.ts
import { describe, expect, it } from "vitest";
import { decideCreateStatus, decideAmendStatus, canSendFrom, canRetryDelivery, type Actor } from "./policy.ts";

const sender: Actor = { id: "p1", label: "shawn@rocking.one", canSend: true };
const gated: Actor = { id: null, label: "Hermes", canSend: false };

describe("create/amend never produce 'sent'", () => {
  it("a gated caller always lands in review", () => {
    expect(decideCreateStatus(gated)).toBe("pending_review");
    expect(decideAmendStatus(gated)).toBe("pending_review");
  });
  it("a sender lands in draft — only send() may set 'sent'", () => {
    expect(decideCreateStatus(sender)).toBe("draft");
    expect(decideAmendStatus(sender)).toBe("draft");
  });
});

describe("canSendFrom", () => {
  it("allows the reviewable states", () => {
    expect(canSendFrom("pending_review")).toBe(true);
    expect(canSendFrom("draft")).toBe(true);
  });
  it("refuses states the client has already acted on", () => {
    for (const s of ["accepted", "rejected", "changes_requested", "expired"] as const) {
      expect(canSendFrom(s)).toBe(false);
    }
  });
  it("refuses a quote already sent — that is the retry path, not this one", () => {
    expect(canSendFrom("sent")).toBe(false);
  });
});

describe("canRetryDelivery", () => {
  it("allows retry when the send event never got a Resend id", () => {
    expect(canRetryDelivery("sent", null)).toBe(true);
  });
  it("refuses retry once delivery was confirmed", () => {
    expect(canRetryDelivery("sent", "<abc@send.rocking.one>")).toBe(false);
  });
  it("is irrelevant for a quote that was never sent", () => {
    expect(canRetryDelivery("draft", null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run lib/quotes/policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/quotes/policy.ts`**

```ts
/** Quote policy: the rules, with no I/O so they can be tested exhaustively.
 *  Only sendQuote may set status 'sent' — a quote marked sent that nobody
 *  received would be the status field telling a lie. */

export type Actor = { id: string | null; label: string; canSend: boolean };

export type QuoteStatus =
  | "draft" | "pending_review" | "sent"
  | "accepted" | "rejected" | "changes_requested" | "expired";

export function decideCreateStatus(actor: Actor): "draft" | "pending_review" {
  return actor.canSend ? "draft" : "pending_review";
}

/** Amending always pulls a live quote out of 'sent', for every actor, so a
 *  revision is never visible to the client before someone sends it. */
export function decideAmendStatus(actor: Actor): "draft" | "pending_review" {
  return actor.canSend ? "draft" : "pending_review";
}

export function canSendFrom(status: QuoteStatus): boolean {
  return status === "draft" || status === "pending_review";
}

/** A quote can read 'sent' while the email never went: the send event's
 *  resend_message_id is written only once Resend confirms. */
export function canRetryDelivery(status: QuoteStatus, sentEventMessageId: string | null): boolean {
  return status === "sent" && sentEventMessageId === null;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run lib/quotes/policy.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/quotes/policy.ts lib/quotes/policy.test.ts
git commit -m "feat(quotes): pure policy module for the quote service layer"
```

---

## Task 6: The service — `create`

**Files:**
- Create: `lib/quotes/service.ts`
- Test: `lib/quotes/service.create.test.ts`

**Interfaces:**
- Consumes: `decideCreateStatus`, `Actor` from `./policy.ts`; `computeTotals` from `./doc.ts`; `QuoteDoc` from `./doc.ts`.
- Produces:
```ts
export type CreateQuoteInput = {
  clientId: string;
  title: string;
  doc: QuoteDoc;
  validUntil?: string | null;
  internal?: { path: string; supplierCost: number | null; note?: string | null }[];
  checkoutEnabled?: boolean;
  billingStartsNextMonth?: boolean;
  idempotencyKey?: string | null;
};
export type CreateResult =
  | { ok: true; quoteId: string; quoteNumber: string; version: number; status: "draft" | "pending_review"; replayed: boolean }
  | { ok: false; error: string };
export function makeQuoteService(sb: SupabaseClient): { create(input, actor): Promise<CreateResult> };
```

- [ ] **Step 1: Write the failing test for idempotent replay**

```ts
// lib/quotes/service.create.test.ts
import { describe, expect, it } from "vitest";
import { makeQuoteService } from "./service.ts";
import type { Actor } from "./policy.ts";

const gated: Actor = { id: null, label: "Hermes", canSend: false };

/** Minimal stub: a quote already exists carrying the idempotency key. */
function sbWithExistingKey() {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "quotes"
              ? { data: { id: "q1", quote_number: "QU-ABC-001", current_version: 1, status: "pending_review" } }
              : { data: null },
        }),
      }),
    }),
  } as never;
}

describe("create is idempotent", () => {
  it("returns the original quote and writes nothing on a repeated key", async () => {
    const svc = makeQuoteService(sbWithExistingKey());
    const res = await svc.create(
      { clientId: "c1", title: "T", doc: {} as never, idempotencyKey: "key-1" },
      gated,
    );
    expect(res).toMatchObject({ ok: true, quoteId: "q1", quoteNumber: "QU-ABC-001", replayed: true });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run lib/quotes/service.create.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `create` in `lib/quotes/service.ts`**

No `server-only`, relative imports only. Order of operations:

1. If `input.idempotencyKey` is set, look for a quote with it. Found → return it with `replayed: true`, writing nothing.
2. Validate: client exists; `input.doc` has at least one item with non-null `qty` and `unitPrice`; `validUntil`, if given, parses and is not in the past. Any failure → `{ ok: false, error }`.
3. Resolve the client's `quote_prefix`. If null → `{ ok: false, error: "client has no quote prefix set" }`. Call `next_quote_number(prefix)` via `sb.rpc`.
4. `computeTotals(input.doc)`; set `doc.meta.quoteNumber`.
5. Insert `quotes` (status from `decideCreateStatus(actor)`, plus `checkout_enabled`, `billing_starts_next_month`, `idempotency_key`).
6. Insert `quote_versions` (version 1, doc, subtotal, vat_amount, grand_total, monthly_total, valid_until).
7. Insert `quote_internal` rows when `input.internal` is non-empty.
8. Insert `quote_events`: `created`, then the status event, both with `actor_profile_id: actor.id`.
9. **If the status is `pending_review`, send the review notification** — to `shawn@rocking.one` and `kelle@rocking.one`, cc `accounts@rocking.one`, via `deliverEmail` with `category: "quote"` and `audience: "internal"`, linking `/admin/quotes/{id}`. This is the only email `create` ever sends, and it goes to staff, never to the client. Wrap it in `try/catch`: a failed notification must not fail the creation, because the quote is already safely in review.
10. On any failure after step 5, delete the rows written so far in child-before-parent order (`quote_internal`, `quote_events`, `quote_versions`, `quotes`) and return `{ ok: false, error }`. Leaving an orphan quote with no version is not acceptable.

- [ ] **Step 4: Run the test**

Run: `npx vitest run lib/quotes/service.create.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify Node can import the service**

```bash
node -e 'import("./lib/quotes/service.ts").then(m => console.log("OK:", Object.keys(m).join(", ")))' 2>/dev/null
```
Expected: `OK: makeQuoteService`.

- [ ] **Step 6: Commit**

```bash
git add lib/quotes/service.ts lib/quotes/service.create.test.ts
git commit -m "feat(quotes): quote service create() with idempotent replay"
```

---

## Task 7: The service — `send` and `amend`

**Files:**
- Modify: `lib/quotes/service.ts`
- Test: `lib/quotes/service.send.test.ts`

**Interfaces:**
- Consumes: `canSendFrom`, `canRetryDelivery`, `decideAmendStatus` from `./policy.ts`; `ensureQuoteBookingLink` from `./booking-link.ts`; `deliverEmail` from `../email/deliver.ts`.
- Produces: `send(quoteId, actor): Promise<SendResult>` and `amend(quoteId, input, actor): Promise<AmendResult>` where
```ts
export type AmendQuoteInput = Pick<CreateQuoteInput, "title" | "doc" | "validUntil" | "internal">;
export type SendResult = { ok: true; sentTo: string[] } | { ok: false; error: string };
export type AmendResult = { ok: true; version: number; status: "draft" | "pending_review" } | { ok: false; error: string };
```

- [ ] **Step 1: Write the failing tests**

```ts
// lib/quotes/service.send.test.ts
import { describe, expect, it } from "vitest";
import { makeQuoteService } from "./service.ts";
import type { Actor } from "./policy.ts";

const gated: Actor = { id: null, label: "Hermes", canSend: false };

describe("send authorisation", () => {
  it("refuses a caller that may not send, without touching the database", async () => {
    let touched = false;
    const sb = { from: () => { touched = true; return {} as never; } } as never;
    const res = await makeQuoteService(sb).send("q1", gated);
    expect(res).toEqual({ ok: false, error: "this caller may not send quotes" });
    expect(touched).toBe(false);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run lib/quotes/service.send.test.ts`
Expected: FAIL — `send is not a function`.

- [ ] **Step 3: Implement `send`**

1. `if (!actor.canSend) return { ok: false, error: "this caller may not send quotes" };` — before any query, so the check is unmistakably first.
2. Load the quote (`id, client_id, quote_number, title, current_version, status`). Missing → error.
3. Load the current version's `sent` event `resend_message_id`.
4. Permitted if `canSendFrom(status)` **or** `canRetryDelivery(status, messageId)`; otherwise `{ ok: false, error: \`cannot send a quote in status "${status}"\` }`.
5. For a first send, flip atomically: `.update({ status: "sent" }).eq("id", id).eq("status", currentStatus)`. A null result means someone else won the race → `{ ok: false, error: "this quote was just sent elsewhere" }`. A retry skips the flip: the status is already `sent`.
6. Insert the `sent` event with `actor_profile_id: actor.id` (skip on retry — the event already exists).
7. `ensureQuoteBookingLink(sb, quoteId)`.
8. Load the client's active `client_manager` emails. None → `{ ok: false, error: "client has no active managers" }`.
9. `deliverEmail` with the Rocky from-address, cc `["shawn@rocking.one", "accounts@rocking.one"]`, `category: "quote"`, `audience: "client"`.
10. Write `resend_message_id` as `<${id}@send.rocking.one>` onto the `sent` event. **This is what makes the retry check work** — without it a successful send looks like a failed one forever.
11. Return `{ ok: true, sentTo }`.

- [ ] **Step 4: Implement `amend`**

1. Load the quote. Missing → error.
2. Refuse from `accepted` (`{ ok: false, error: "cannot amend an accepted quote" }`).
3. Insert a new `quote_versions` row at `current_version + 1` with recomputed totals, plus its `quote_internal` rows.
4. Update `quotes`: `current_version`, `title`, and `status = decideAmendStatus(actor)` — never left at `sent`.
5. Insert a `quote_events` row **only when the new status is `pending_review`**, with `actor_profile_id: actor.id`. Do NOT insert an event named `draft`: `quote_events.event` is constrained by migration `0059_quote_pending_review.sql` to `created, pending_review, sent, viewed, accepted, rejected, changes_requested`, so a `draft` event throws. (Task 6 hit exactly this; the plan text was wrong.) For a `draft` amend the new `quote_versions` row is itself the record.
6. Return `{ ok: true, version, status }`.

- [ ] **Step 5: Test that amend pulls a live quote out of `sent`**

This is the back door the whole design exists to close, so it gets its own test. Append to `lib/quotes/service.send.test.ts`:

```ts
describe("amend never leaves a quote live", () => {
  it("returns a sent quote to review for a gated caller", async () => {
    const updates: Record<string, unknown>[] = [];
    const sb = {
      from: (table: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: "q1", client_id: "c1", title: "T", current_version: 1, status: "sent" },
        }) }) }),
        insert: async () => ({ data: [{ id: "v2" }], error: null }),
        update: (row: Record<string, unknown>) => {
          if (table === "quotes") updates.push(row);
          return { eq: () => ({ select: () => ({ maybeSingle: async () => ({ data: { id: "q1" } }) }) }) };
        },
      }),
    } as never;

    const res = await makeQuoteService(sb).amend("q1", { title: "T", doc: {} as never }, gated);
    expect(res).toMatchObject({ ok: true, status: "pending_review" });
    expect(updates.some((u) => u.status === "sent")).toBe(false);
  });
});
```

Adjust the stub's shape to match whatever your `amend` implementation actually calls — the assertions are the point: the result status is `pending_review`, and no update ever writes `status: "sent"`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run lib/quotes` — expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add lib/quotes/service.ts lib/quotes/service.send.test.ts
git commit -m "feat(quotes): quote service send() and amend() with the review gate"
```

---

## Task 8: Migrate `approveAndSendQuote`

**Files:**
- Modify: `app/(admin)/admin/quotes/actions.ts:43-102`

**Interfaces:**
- Consumes: `makeQuoteService` from `@/lib/quotes/service`; `createServiceClient` from `@/lib/supabase/service`.
- Produces: no signature change — `approveAndSendQuote(quoteId): Promise<AdminDecisionResult>` stays as it is, so `ApproveAndSendQuote.tsx` needs no edit.

- [ ] **Step 1: Replace the body**

Keep the staff auth check exactly as it is, then delegate:

```ts
const me = await getCurrentProfile();
if (!me.authenticated || me.profile.role !== "rocking_staff") {
  return { ok: false, error: "only rocking staff may approve quotes" };
}

const svc = makeQuoteService(createServiceClient());
const res = await svc.send(quoteId, {
  id: me.profile.id,
  label: me.profile.email,
  canSend: true, // a staff member clicking in the portal, having seen the quote
});
if (!res.ok) return { ok: false, error: res.error };

revalidatePath(`/admin/quotes/${quoteId}`);
revalidatePath("/admin/quotes");
return { ok: true };
```

Delete the now-duplicated status flip, event insert and `notifyQuoteSent` call from this action.

- [ ] **Step 2: Confirm the stranding bug is gone**

The old code returned an error after flipping to `sent`, leaving the quote unsendable. Re-read the new path and confirm that a Resend failure leaves the `sent` event with a null `resend_message_id`, so `canRetryDelivery` returns true and pressing the button again retries.

- [ ] **Step 3: Verify**

Run: `npx vitest run` — all pass.
Run: `npx tsc --noEmit 2>&1 | grep -v "lib/views/status\|app/(app)/layout\|lib/actions/status\|.next/types"` — no output.

- [ ] **Step 4: Exercise it against a real quote**

Create a quote in `pending_review` for a scratch client whose only manager is an address you control, click **Approve and send** in the admin UI, and confirm: status becomes `sent`, the `sent` event carries an actor and a `resend_message_id`, a `sent_emails` row exists, and the mail arrives. Then delete the scratch quote.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/quotes/actions.ts"
git commit -m "refactor(quotes): approveAndSendQuote delegates to the quote service"
```

---

## Task 9: Migrate `create-quote.mjs` onto the service

**Files:**
- Modify: `scripts/create-quote.mjs`

**Interfaces:**
- Consumes: `makeQuoteService` from `../lib/quotes/service.ts`.
- Produces: same CLI flags, with one deliberate behaviour change described below.

- [ ] **Step 1: Rewrite the write path**

Replace the inline inserts with:

```js
import { makeQuoteService } from "../lib/quotes/service.ts";

const svc = makeQuoteService(sb);
const actor = { id: null, label: "create-quote.mjs", canSend: true };

const res = amendId
  ? await svc.amend(amendId, { clientId, title, doc, validUntil, internal }, actor)
  : await svc.create({ clientId, title, doc, validUntil, internal,
      checkoutEnabled, billingStartsNextMonth: billingNextMonth,
      idempotencyKey: process.env.QUOTE_IDEMPOTENCY_KEY ?? null }, actor);
if (!res.ok) { console.error(res.error); process.exit(1); }
```

Then, unless `--no-email` was passed, `await svc.send(quoteId, actor)`.

- [ ] **Step 2: Handle the deliberate behaviour change**

`create` no longer produces `sent`; it produces `draft`. Without `--no-email` the script now creates **and then sends**, reaching the same end state by two calls instead of one. With `--no-email` the quote stays in `draft` — which is what the current workflow simulates by hand (create, flip to draft, review, send). Update the usage comment at the top of the file to say so.

`--pending-review` becomes `actor.canSend = false`, which lands the quote in `pending_review` and skips sending entirely. Delete the old `initialStatus` variable and the hand-rolled reviewer email; `create` sends the review notification itself.

- [ ] **Step 3: Verify against a scratch quote**

Create with `--no-email` and confirm status is `draft`; create with `--pending-review` and confirm status is `pending_review` and that shawn@ and kelle@ received the review email; create plainly against a scratch client you control and confirm the client email arrives and status is `sent`. Delete all three afterwards.

- [ ] **Step 4: Confirm the duplication is gone**

```bash
grep -n "api.resend.com\|function computeTotals\|sent_emails" scripts/create-quote.mjs
```
Expected: no output. Every one of those now lives in exactly one place.

- [ ] **Step 5: Commit**

```bash
git add scripts/create-quote.mjs
git commit -m "refactor(quotes): create-quote.mjs runs on the quote service"
```

---

## Task 10: Update the operator documentation

**Files:**
- Modify: `~/.claude/scheduled-tasks/process-inbound-quote-emails/SKILL.md`
- Modify: `scripts/create-quote.mjs` (header comment, if not already done in Task 9)

**Interfaces:**
- Consumes: the finished CLI behaviour from Task 9.
- Produces: no code.

- [ ] **Step 1: Update the quote-creation rule in SKILL.md**

The "Creating a quote" section describes a flow where the script creates and emails in one call. Rewrite it to state that creation and sending are separate, that `--pending-review` is the required flag for pipeline-built quotes, and that a quote created without it lands in `draft` and needs an explicit send.

- [ ] **Step 2: Record the runtime constraint where the next person will hit it**

Add a short note to the SKILL.md and to the top of `lib/quotes/service.ts` stating that shared modules must avoid `server-only` and `@/` aliases so plain Node can import them, with the one-line reason. This is the single most surprising constraint in this design.

- [ ] **Step 3: Commit**

```bash
git add scripts/create-quote.mjs lib/quotes/service.ts
git commit -m "docs(quotes): document the split create/send flow and the Node import constraint"
```
