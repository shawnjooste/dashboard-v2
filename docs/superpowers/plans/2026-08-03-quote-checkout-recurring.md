# Quote Checkout with Recurring Billing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checkout-enabled quotes take one card payment (once-off + pro-rata) via Paystack, then auto-bill monthly on the 1st from a stored authorization via daily Vercel Cron.

**Architecture:** Hosted checkout (card-only) captures a reusable authorization; we schedule charges ourselves with `charge_authorization` — Paystack Subscriptions deliberately unused. Idempotency via a partial unique index (one *success* per subscription+period) and deterministic references `qs-<sub>-<yyyymm>-a<n>`.

**Tech Stack:** Next.js App Router server actions, Supabase (service-role + RLS), Paystack REST, Vercel Cron, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-03-quote-checkout-recurring-design.md`

## Global Constraints

- Money is integer **cents** everywhere; no float currency math.
- Pro-rata: daily rate = monthly ex-VAT ÷ actual days in month; billable from (acceptance date + 3 days) through month-end; clamps to 0 across month-end.
- Retries day 1/3/5 (attempt N+1 only when latest failed attempt is ≥2 days old, max 3), then flip `failed` + one email each to Shawn and client. **Never auto-suspend.**
- Cron: `15 4 * * *` (06:15 SAST), guarded by existing `CRON_SECRET` bearer, GET+POST identical.
- Emails go through `lib/email/send.ts` (`sendEmail`), from `"Rocky @ Rocking" <quotes@send.rocking.one>`, category `billing`.
- Migration numbering: repo shared with concurrent sessions — `git pull` and re-check `ls supabase/migrations | tail -1` immediately before creating the file; renumber on collision.
- After each migration: `supabase db push` then `supabase gen types typescript --linked > lib/types/database.ts`.

---

### Task 1: Schema — checkout flag, subscriptions, charges

**Files:**
- Create: `supabase/migrations/0077_quote_subscriptions.sql` (renumber if needed)
- Modify: `lib/types/database.ts` (regenerated)

**Interfaces:**
- Produces tables `quote_subscriptions`, `quote_subscription_charges`, column `quotes.checkout_enabled` exactly as in the spec's Data model section (statuses: subscription `pending_payment|active|cancelled|failed`; charge `pending|success|failed`; `charge_type initial|recurring`).

- [x] **Step 1: Write migration** — SQL verbatim from spec §Data model (both tables, both check constraints, `quote_subscriptions_quote_idx` unique on quote_id, charges sub/period index, partial unique success index, RLS: staff-all on both + manager-select-own via `client_id = public.current_client_id()`; for charges the manager policy uses `exists (select 1 from quote_subscriptions s where s.id = subscription_id and s.client_id = public.current_client_id())`).
- [x] **Step 2:** `supabase db push` → applied cleanly.
- [x] **Step 3:** Regenerate types; `npx tsc --noEmit` clean.
- [x] **Step 4:** Commit `feat(billing): quote subscription schema`.

### Task 2: Pure billing logic + tests

**Files:**
- Create: `lib/subscriptions/billing.ts`, `lib/subscriptions/billing.test.ts`

**Interfaces (produced, exact):**
```ts
export type InitialBreakdown = {
  onceOffCents: number; proRataCents: number; billableDays: number;
  periodStart: string | null; periodEnd: string | null;  // "yyyy-mm-dd", null when 0 days
  billingPeriod: string;      // first of acceptance month "yyyy-mm-01"
  exVatCents: number; vatCents: number; totalCents: number;
};
export function computeInitialBreakdown(opts: {
  onceOffExCents: number; monthlyExCents: number; vatPercent: number; today: Date;
}): InitialBreakdown;

export function firstOfNextMonth(d: Date): string;            // "yyyy-mm-01"
export function chargeReference(subId: string, billingPeriod: string, attempt: number): string; // qs-<sub>-<yyyymm>-a<n>

export type ChargeRow = { billing_period: string; status: "pending"|"success"|"failed"; attempt_number: number; created_at: string };
export type CronDecision =
  | { action: "charge"; attempt: number }
  | { action: "exhausted" }
  | { action: "wait" }
  | { action: "advance" };   // success already recorded — just move next_charge_date on
export function decideCharge(periodCharges: ChargeRow[], today: Date): CronDecision;
```
- [x] **Step 1: Failing tests** covering: mid-month (20th of 31-day month → 9 days, 9/31 rounding); grace crosses month-end (29th of 30-day month → 0 days, proRata 0); Feb vs Jan divisor; 1st-of-month signup (28 billable in 31-day month); VAT applied once on combined ex-VAT; `decideCharge`: no rows→charge a1; failed a1 today→wait; failed a1 two days ago→charge a2; failed a3→exhausted; success present→advance; pending row (in-flight)→wait.
- [x] **Step 2:** Run → fails (module missing).
- [x] **Step 3:** Implement (UTC date math; `Math.round` on the pro-rata product; days-in-month via `new Date(Date.UTC(y, m+1, 0)).getUTCDate()`).
- [x] **Step 4:** `npx vitest run lib/subscriptions/billing.test.ts` → all pass.
- [x] **Step 5:** Commit `feat(billing): pure pro-rata + cron-decision logic`.

### Task 3: Paystack client extensions

**Files:**
- Modify: `lib/paystack.ts`

**Interfaces (produced):**
```ts
initializeTransaction(opts: { email; amountCents; reference; callbackUrl; channels?: string[] }): Promise<string>
verifyTransaction(reference): Promise<{ paid: boolean; amountCents: number; authorizationCode: string | null; customerCode: string | null }>
chargeAuthorization(opts: { email: string; amountCents: number; reference: string; authorizationCode: string }):
  Promise<{ success: boolean; failureReason: string | null }>
```
- [x] **Step 1:** Add optional `channels` passthrough to initialize; extend verify's return (`data.authorization?.authorization_code`, `data.customer?.customer_code`); add `chargeAuthorization` via `POST /transaction/charge_authorization` — note a *decline* is HTTP 200 + `data.status !== "success"`, so it must NOT throw: return `{ success:false, failureReason: data.gateway_response ?? data.status }`. (`ps()` only throws on transport/API errors, which callers treat as "leave pending, retry next run".)
- [x] **Step 2:** `npx tsc --noEmit` clean; existing booking callers unaffected (param optional). Commit `feat(paystack): channels, richer verify, charge_authorization`.

### Task 4: Subscription store — checkout + idempotent confirm

**Files:**
- Create: `lib/subscriptions/store.ts`

**Interfaces (produced):**
```ts
export async function startCheckout(opts: { quoteId: string; email: string }): Promise<{ ok: true; url: string } | { ok: false; error: string }>;
export async function confirmSubscriptionCharge(reference: string, amountPaidCents: number,
  auth?: { authorizationCode: string | null; customerCode: string | null }):
  Promise<"confirmed" | "already" | "not_found" | "underpaid">;
```
- [x] **Step 1: Implement `startCheckout`** (service client): load quote (`checkout_enabled`, status `sent`, client_id, current_version) + version doc → `computeTotals` → `onceOffEx = totals.subtotal`, `monthlyEx = totals.revenueExVat - totals.subtotal` (cents via `Math.round(x*100)`); `computeInitialBreakdown`; upsert-or-reuse the quote's subscription row (`pending_payment`, monthly+vat cents); insert `initial` charge row, attempt = max existing initial attempt + 1 (re-click after abandon = new attempt, new reference); `initializeTransaction` with `channels:["card"]`, callback `${APP_URL}/quotes/<id>`; on initialize failure mark that charge row `failed` and return error.
- [x] **Step 2: Implement `confirmSubscriptionCharge`** — reference → charge row (join subscription). Not found → `not_found`. Row already `success` → `already`. Paid < row total → `underpaid` (log). Else atomically flip charge to `success` (guard `.eq("status","pending")` OR failed→success for recovery), stamp `charged_at`; then by context: **initial** (sub `pending_payment`) → store auth codes, sub→`active`, `activated_at`, `next_charge_date = firstOfNextMonth(today)`, quote→`accepted` + `quote_events` row (`event:'accepted'`, comment `Paid via checkout (ref …)`), notify Shawn via `sendEmail` (internal); **recovery** (sub `failed`) → store new auth codes, sub→`active`, `next_charge_date = firstOfNextMonth(billing_period)`; **recurring backup** (sub `active`) → charge flip only. All side-effects best-effort after the paid-flip, mirroring `confirmBooking`.
- [x] **Step 3:** `npx tsc --noEmit`; commit `feat(billing): checkout start + idempotent charge confirm`.

### Task 5: Webhook + verify fallback routing

**Files:**
- Modify: `app/api/paystack/webhook/route.ts`

- [x] **Step 1:** In `charge.success`, branch on reference prefix: `qs-` → `confirmSubscriptionCharge(ref, amount, { authorizationCode: data.authorization?.authorization_code ?? null, customerCode: data.customer?.customer_code ?? null })`; else existing `confirmBooking`. Extend the parsed event type with `authorization`/`customer` fields.
- [x] **Step 2:** typecheck; commit `feat(billing): route qs- references through subscription confirm`.

### Task 6: Client checkout UI + recovery page

**Files:**
- Modify: `app/(app)/quotes/[id]/page.tsx`, `app/(app)/quotes/[id]/QuoteActions.tsx`, `app/(app)/quotes/[id]/actions.ts`
- Create: `app/(app)/quotes/[id]/pay/page.tsx`, `lib/views/subscriptions.ts`

**Interfaces:**
- Consumes `startCheckout`, `confirmSubscriptionCharge`, `verifyTransaction`, `computeInitialBreakdown`.
- Produces `getSubscriptionForQuote(quoteId): Promise<SubView | null>` where `SubView = { id, status, monthlyInclCents, nextChargeDate, failedPeriod: string | null }` (service-role read, used by both client + admin pages).

- [x] **Step 1: `actions.ts`** — add `export async function checkoutQuote(quoteId: string): Promise<{ok:true;url:string}|{ok:false;error:string}>`: manager-of-this-client + feature guard (same as `decide`), then `startCheckout({ quoteId, email: me.profile.email })`.
- [x] **Step 2: page.tsx** — compute breakdown server-side when `checkout_enabled && status==='sent'` and pass `checkout={{ onceOff, proRata, periodStart, periodEnd, monthlyIncl, totalIncl }}` (formatted strings) to `QuoteActions`; on landing with `?reference=qs-…` or `trxref`, run `verifyTransaction` → if paid, `confirmSubscriptionCharge` (fallback path) before rendering; when subscription active, render an "Active — billed monthly" banner (monthly incl VAT + next billing date) in place of the decision banner.
- [x] **Step 3: QuoteActions** — when `checkout` prop present, replace Accept with **Checkout** button opening a panel: once-off line, pro-rata line with covered dates (or "Your first month starts on the 1st — no pro-rata" when 0), bold recurring disclosure "R X incl VAT will be billed automatically on the 1st of every month until cancelled", then **Pay now** → `checkoutQuote` → `window.location.href = url`. Decline/request-changes untouched.
- [x] **Step 4: pay/page.tsx (arrears)** — manager-guarded; load failed subscription; show owed period + amount; button → server action reusing `startCheckout`-style init but reference `chargeReference(sub, failedPeriod, attempt+1)` and amount = monthly incl; card-only; callback back to `/quotes/<id>`. (Implemented as `payArrears` in `lib/subscriptions/store.ts`.)
- [x] **Step 5:** typecheck; commit `feat(billing): client checkout, disclosure, arrears recovery`.

### Task 7: Daily cron + failure emails

**Files:**
- Create: `app/api/jobs/subscription-charges/route.ts`
- Modify: `vercel.json`, `lib/quote-emails.ts` (or inline via `sendEmail`)

- [x] **Step 1: route** — clone `jobs/digest` guard shape (GET+POST → shared handler, `CRON_SECRET`). For each `active` sub with `next_charge_date <= today`: load that period's charges → `decideCharge`; `advance` → set `next_charge_date = firstOfNextMonth(period)`; `charge` → insert pending row (attempt N, `chargeReference`), `chargeAuthorization` (email = client's first active manager email; amount = monthly+vat) → success: flip row success + advance `next_charge_date`; decline: flip row failed with reason, and if attempt was 3 → sub `failed` + email Shawn (internal, links admin quote) + email client managers (audience client, links `${APP_URL}/quotes/<id>/pay`); transport error → leave pending, log, continue. Returns JSON summary `{charged, failed, advanced, skipped}`.
- [x] **Step 2:** add `{"path":"/api/jobs/subscription-charges","schedule":"15 4 * * *"}` to `vercel.json` crons.
- [x] **Step 3:** typecheck; local smoke `curl -H "Authorization: Bearer $CRON_SECRET"` against `next dev` → `{...skipped:0}` shape sane with zero subscriptions.
- [x] **Step 4:** Commit `feat(billing): daily subscription charge cron`.

### Task 8: Admin card — status, history, stop, charge-now

**Files:**
- Create: `app/(admin)/admin/quotes/[id]/SubscriptionCard.tsx`
- Modify: `app/(admin)/admin/quotes/actions.ts`, `app/(admin)/admin/quotes/[id]/page.tsx`, `lib/views/subscriptions.ts`

- [x] **Step 1: views** — `getSubscriptionAdminDetail(quoteId)`: subscription + all charges ordered desc `{period, attempt, amountIncl, status, failureReason, chargedAt}`.
- [x] **Step 2: actions** — `stopSubscription(quoteId)` staff-guarded: `active|failed → cancelled` atomic, stamp `cancelled_at/by`, `quote_events` note; `chargeSubscriptionNow(quoteId)` staff-guarded: run the same per-subscription charge routine as the cron for the due/failed period (shared function exported from the cron's lib — factor the per-sub logic into `lib/subscriptions/run-charge.ts` so cron and button cannot diverge), resetting a `failed` sub to `active` first so `decideCharge` can act.
- [x] **Step 3: SubscriptionCard** — pill (active amber/good per status), monthly incl, next charge date, history table, Stop + Charge now buttons (useTransition, error text inline, same styling as ApproveAndSendQuote).
- [x] **Step 4: wire into admin page** below the PO card: `{sub && <SubscriptionCard …/>}`.
- [x] **Step 5:** typecheck; commit `feat(billing): admin subscription card + stop/charge-now`.

### Task 9: Enable via script + docs

**Files:**
- Modify: `scripts/create-quote.mjs`

- [x] **Step 1:** `--checkout` flag → sets `checkout_enabled: true` on insert (both new + amend paths update the quotes row) and prints "Checkout: ENABLED (client pays instead of accepting)". Header comment updated.
- [x] **Step 2:** Commit `feat(billing): --checkout flag on quote script`.

### Task 10: Verification sweep

- [x] **Step 1:** `npx tsc --noEmit` clean; `npx vitest run` full suite green.
- [x] **Step 2:** Push → Vercel deploy READY; `vercel env ls` shows CRON_SECRET; hit cron route unauthenticated → 401, with bearer → 200 `{charged:0,…}`.
- [x] **Step 3:** Test-mode dry run (`PAYSTACK_USE_TEST=1`, script-created throwaway quote on the internal Rocking client, `--checkout --no-email`): startCheckout returns a Paystack URL; complete payment with test card 4084 0840 8408 4081 in browser pane; webhook flips sub active with stored authorization; run cron with `next_charge_date` forced to today → charge_authorization succeeds against stored test auth; force-fail path exercised by pointing amount at a Paystack test-decline; clean up throwaway rows.
- [x] **Step 4:** Final commit + push.

## Self-review

- Spec coverage: schema ✓ (T1), pro-rata+grace ✓ (T2), card-only+disclosure ✓ (T6), initial confirm+quote-accepted ✓ (T4/5), cron+retry+flag emails ✓ (T7), arrears recovery ✓ (T6), staff cancel + charge-now ✓ (T8), client read-only view ✓ (T6), opt-in flag ✓ (T9), tests ✓ (T2/T10). Out-of-scope items untouched.
- Type consistency: `decideCharge`/`chargeReference`/`firstOfNextMonth` names used identically across T2/T4/T6/T7/T8; `SubView` only in views.
- No placeholders remain.
