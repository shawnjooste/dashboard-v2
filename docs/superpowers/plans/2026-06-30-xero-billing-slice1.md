# Xero Billing — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client-facing Billing section that shows each mapped client their Xero invoices (balance, open, paid, credit notes), refreshed nightly — piloted on GSR Law.

**Architecture:** Mirrors the M365 integration. One encrypted Xero OAuth connection (Rocking's org) → a nightly `xero-pull` that, per client mapped to a Xero Contact, ingests their invoices into the Portal DB → a `/billing` page (managers) reading a per-client snapshot behind RLS. Pure logic (date/status/grouping) lives in a shared `.mjs` helper used by both the pull and the view.

**Tech Stack:** Node ESM (`.mjs`) for the Xero client/scripts (reuses the existing AES-GCM helpers in `lib/m365-graph.mjs`), Next.js 16 server components, Supabase + RLS, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-30-xero-billing-design.md`.
- **Supabase project:** `eskhokedsximnslgsycs` (dashboard-v2). Migrations via `supabase db push --linked`; types via `supabase gen types typescript --linked > lib/types/database.ts`.
- **Client-facing financial data:** only `AUTHORISED` and `PAID` invoices are ever ingested or shown. Never `DRAFT` / `SUBMITTED` / `DELETED` / `VOIDED`.
- **Per-client opt-in:** a client sees Billing only when `clients.xero_contact_id` is set.
- **RLS:** `xero_invoices` / `client_billing` are `is_rocking_staff() OR client_id = current_client_id()`. `xero_connection` is staff-only. Service-role + `XERO_TOKEN_ENC_KEY` live only in the pull/CLI, never the client bundle.
- **Nightly snapshot** with an "as of" label; PDFs are **out of scope for Slice 1** (Slice 2).
- No new runtime npm deps (built-in `fetch`, `node:*`, reuse `@supabase/supabase-js`).

## Pre-flight (wiring — required before Task 3 runs)

Add to `dashboard-v2/.env.local` (git-ignored):
```
XERO_CLIENT_ID=<from a Xero OAuth2 app you register at developer.xero.com>
XERO_CLIENT_SECRET=<from that app>
XERO_REDIRECT_URI=http://localhost:8737/callback
XERO_TOKEN_ENC_KEY=<32 random bytes, base64 — generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))">
```
The Xero app needs `accounting.transactions.read`, `accounting.contacts.read`, `offline_access` scopes and the redirect URI above registered. Also add the same vars to Vercel (the Billing page itself only reads the DB, but keep parity).

---

## File Structure

- `supabase/migrations/0041_xero_billing.sql` — tables, `clients.xero_contact_id`, RLS.
- `lib/xero-helpers.mjs` — **pure** logic: parse Xero `/Date()/`, visible-status filter, invoice normalisation, billing summary + grouping. Shared by the pull and the view.
- `lib/xero-helpers.test.mjs` — `node --test` for the pure helpers.
- `lib/xero-api.mjs` — Xero HTTP client: token exchange/refresh, tenant lookup, find contact, list invoices/credit notes. Reuses `encryptSecret`/`decryptSecret` from `lib/m365-graph.mjs`.
- `scripts/xero-connect.mjs` — one-time OAuth auth-code sign-in (local redirect catcher) → stores the encrypted refresh token + tenant.
- `scripts/xero-map.mjs` — map a Portal client to a Xero Contact by name (`<clientId> "<Contact Name>"`), with a confirm print.
- `scripts/xero-pull.mjs` — `--all` | `<clientId>`: refresh token → per mapped client, ingest invoices → upsert `xero_invoices` + recompute `client_billing`.
- `lib/views/billing.ts` — `getClientBilling(clientId)` (server; reads the snapshot, groups via helpers).
- `app/(app)/billing/page.tsx` — the client Billing page.
- `components/BillingView.tsx` — presentational billing UI.
- `lib/nav.ts`, `components/AppShell.tsx`, `app/(app)/layout.tsx` — add the (conditional) Billing nav item.
- `com.rocking.xero-pull.plist` (delivered into `~/Library/LaunchAgents/`) — nightly schedule.

---

### Task 1: Migration — tables + mapping + RLS

**Files:**
- Create: `supabase/migrations/0041_xero_billing.sql`
- Modify: `lib/types/database.ts` (regenerated)

**Interfaces:**
- Produces: `clients.xero_contact_id (text, nullable)`; tables `xero_connection`, `xero_invoices`, `client_billing` (columns below) consumed by Tasks 4–6.

- [ ] **Step 1: Write the migration**

`supabase/migrations/0041_xero_billing.sql`:

```sql
-- Xero billing: one org connection, per-client Contact mapping, ingested
-- invoices + a per-client summary. Client-facing (RLS), staff manage the link.

-- One encrypted OAuth connection for Rocking's Xero org.
create table public.xero_connection (
  id               int primary key default 1 check (id = 1), -- singleton
  tenant_id        text,
  tenant_name      text,
  token_ciphertext text not null,
  token_iv         text not null,
  token_tag        text not null,
  status           text not null default 'connected',
  last_pull_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Map a Portal client to its Xero Contact. Null = no Billing tab.
alter table public.clients add column if not exists xero_contact_id text;

-- Ingested invoices + credit notes (AUTHORISED/PAID only).
create table public.xero_invoices (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  xero_invoice_id text not null unique,
  number          text,
  type            text not null check (type in ('invoice','credit_note')),
  status          text not null,
  date            date,
  due_date        date,
  total           numeric(14,2),
  amount_due      numeric(14,2),
  amount_paid     numeric(14,2),
  currency        text,
  import_run_id   uuid references public.import_runs(id),
  updated_at      timestamptz not null default now()
);
create index xero_invoices_client_idx on public.xero_invoices (client_id);

-- Per-client summary for fast page loads.
create table public.client_billing (
  client_id    uuid primary key references public.clients(id) on delete cascade,
  outstanding  numeric(14,2) not null default 0,
  overdue      numeric(14,2) not null default 0,
  currency     text,
  as_of        date,
  updated_at   timestamptz not null default now()
);

alter table public.xero_connection enable row level security;
alter table public.xero_invoices   enable row level security;
alter table public.client_billing  enable row level security;

-- Connection: staff only.
create policy xero_connection_staff on public.xero_connection
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Invoices + summary: a client sees only their own; staff see all.
create policy xero_invoices_read on public.xero_invoices
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
create policy xero_invoices_staff_write on public.xero_invoices
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
create policy client_billing_read on public.client_billing
  for select using (public.is_rocking_staff() or client_id = public.current_client_id());
create policy client_billing_staff_write on public.client_billing
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());
```

- [ ] **Step 2: Push + regenerate types**

Run: `supabase db push --linked && supabase gen types typescript --linked > lib/types/database.ts`
Expected: applies `0041`; `grep -c "xero_invoices" lib/types/database.ts` > 0.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0041_xero_billing.sql lib/types/database.ts
git commit -m "feat(xero): billing tables + client mapping + RLS"
```

---

### Task 2: Pure helpers (`xero-helpers.mjs`) + tests

**Files:**
- Create: `lib/xero-helpers.mjs`
- Test: `lib/xero-helpers.test.mjs`

**Interfaces:**
- Produces (consumed by Tasks 4 + 5):
  - `parseXeroDate(s) -> string|null` — Xero `/Date(ms+zone)/` or ISO → `YYYY-MM-DD`.
  - `VISIBLE_STATUSES` (`["AUTHORISED","PAID"]`) and `isVisibleStatus(status) -> boolean`.
  - `normalizeInvoice(raw, type) -> { xero_invoice_id, number, type, status, date, due_date, total, amount_due, amount_paid, currency }`.
  - `summarize(invoices, todayIso) -> { outstanding, overdue, currency, openCount }` (numbers; overdue = open + due_date < today).
  - `groupInvoices(invoices) -> { open, paid, creditNotes }`.

- [ ] **Step 1: Write the failing test**

`lib/xero-helpers.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseXeroDate, isVisibleStatus, normalizeInvoice, summarize, groupInvoices } from "./xero-helpers.mjs";

test("parseXeroDate handles Xero /Date()/ and ISO", () => {
  assert.equal(parseXeroDate("/Date(1782950400000+0000)/"), "2026-07-01");
  assert.equal(parseXeroDate("2026-07-01T00:00:00"), "2026-07-01");
  assert.equal(parseXeroDate(null), null);
});

test("isVisibleStatus only AUTHORISED/PAID", () => {
  assert.equal(isVisibleStatus("AUTHORISED"), true);
  assert.equal(isVisibleStatus("PAID"), true);
  assert.equal(isVisibleStatus("DRAFT"), false);
  assert.equal(isVisibleStatus("VOIDED"), false);
});

test("normalizeInvoice maps Xero fields", () => {
  const n = normalizeInvoice({
    InvoiceID: "abc", InvoiceNumber: "INV-2766", Status: "AUTHORISED",
    Date: "/Date(1782864000000+0000)/", DueDate: "/Date(1782950400000+0000)/",
    Total: 50361.95, AmountDue: 50361.95, AmountPaid: 0, CurrencyCode: "ZAR",
  }, "invoice");
  assert.equal(n.xero_invoice_id, "abc");
  assert.equal(n.number, "INV-2766");
  assert.equal(n.due_date, "2026-07-01");
  assert.equal(n.amount_due, 50361.95);
});

test("summarize totals outstanding + overdue", () => {
  const inv = [
    normalizeInvoice({ InvoiceID: "1", Status: "AUTHORISED", DueDate: "/Date(1782950400000+0000)/", Total: 100, AmountDue: 100, AmountPaid: 0, CurrencyCode: "ZAR" }, "invoice"),
    normalizeInvoice({ InvoiceID: "2", Status: "PAID", DueDate: "/Date(1782950400000+0000)/", Total: 50, AmountDue: 0, AmountPaid: 50, CurrencyCode: "ZAR" }, "invoice"),
    normalizeInvoice({ InvoiceID: "3", Status: "AUTHORISED", DueDate: "/Date(1577836800000+0000)/", Total: 30, AmountDue: 30, AmountPaid: 0, CurrencyCode: "ZAR" }, "invoice"),
  ];
  const s = summarize(inv, "2026-06-30");
  assert.equal(s.outstanding, 130);   // 100 + 30 still due
  assert.equal(s.overdue, 30);        // only #3 is past due (2020 date)
  assert.equal(s.currency, "ZAR");
});

test("groupInvoices splits open / paid / credit notes", () => {
  const inv = [
    { type: "invoice", status: "AUTHORISED", amount_due: 100 },
    { type: "invoice", status: "PAID", amount_due: 0 },
    { type: "credit_note", status: "PAID", amount_due: 0 },
  ];
  const g = groupInvoices(inv);
  assert.equal(g.open.length, 1);
  assert.equal(g.paid.length, 1);
  assert.equal(g.creditNotes.length, 1);
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- lib/xero-helpers.test.mjs` (or `node --test lib/xero-helpers.test.mjs`)
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/xero-helpers.mjs`**

```js
// Pure Xero billing helpers — no I/O, shared by the pull (.mjs) and the view (.ts).

export const VISIBLE_STATUSES = ["AUTHORISED", "PAID"];
export const isVisibleStatus = (s) => VISIBLE_STATUSES.includes(s);

/** Xero returns "/Date(ms+zone)/"; newer payloads ISO. -> YYYY-MM-DD or null. */
export function parseXeroDate(s) {
  if (!s) return null;
  const m = /\/Date\((\d+)/.exec(s);
  const ms = m ? Number(m[1]) : Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

const num = (v) => (v == null ? null : Number(v));

export function normalizeInvoice(raw, type) {
  return {
    xero_invoice_id: raw.InvoiceID ?? raw.CreditNoteID,
    number: raw.InvoiceNumber ?? raw.CreditNoteNumber ?? null,
    type, // 'invoice' | 'credit_note'
    status: raw.Status,
    date: parseXeroDate(raw.Date),
    due_date: parseXeroDate(raw.DueDate),
    total: num(raw.Total),
    amount_due: num(raw.AmountDue),
    amount_paid: num(raw.AmountPaid),
    currency: raw.CurrencyCode ?? null,
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

export function summarize(invoices, todayIso) {
  let outstanding = 0, overdue = 0, openCount = 0, currency = null;
  for (const i of invoices) {
    if (i.type !== "invoice") continue;
    const due = i.amount_due ?? 0;
    if (due > 0) {
      outstanding += due;
      openCount += 1;
      if (i.due_date && i.due_date < todayIso) overdue += due;
      currency = currency ?? i.currency;
    }
  }
  return { outstanding: round2(outstanding), overdue: round2(overdue), currency, openCount };
}

export function groupInvoices(invoices) {
  const open = [], paid = [], creditNotes = [];
  for (const i of invoices) {
    if (i.type === "credit_note") creditNotes.push(i);
    else if ((i.amount_due ?? 0) > 0) open.push(i);
    else paid.push(i);
  }
  return { open, paid, creditNotes };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test lib/xero-helpers.test.mjs`
Expected: PASS (all green).

- [ ] **Step 5: Commit**

```bash
git add lib/xero-helpers.mjs lib/xero-helpers.test.mjs
git commit -m "feat(xero): pure billing helpers (date/status/normalize/summary) + tests"
```

---

### Task 3: Xero API client + one-time connect

**Files:**
- Create: `lib/xero-api.mjs`
- Create: `scripts/xero-connect.mjs`

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret` from `lib/m365-graph.mjs`.
- Produces (consumed by Task 4):
  - `xeroEnv() -> { XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_REDIRECT_URI, XERO_TOKEN_ENC_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY }` (from `.env.local`).
  - `exchangeCode(env, code) -> { access_token, refresh_token }`
  - `refreshToken(env, refreshToken) -> { access_token, refresh_token }`
  - `getTenants(accessToken) -> [{ tenantId, tenantName }]`
  - `xeroGet(accessToken, tenantId, path) -> any` (JSON, `Accept: application/json`)

- [ ] **Step 1: Implement `lib/xero-api.mjs`**

```js
// Xero Accounting API client (read-only). Reuses the AES-GCM token crypto from
// the M365 integration. No per-call retry beyond token refresh.
import { readFileSync } from "node:fs";
export { encryptSecret, decryptSecret } from "./m365-graph.mjs";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const API = "https://api.xero.com/api.xro/2.0";

export function xeroEnv() {
  const env = {};
  for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  for (const k of ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_REDIRECT_URI", "XERO_TOKEN_ENC_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!env[k]) throw new Error(`${k} missing from .env.local`);
  }
  return env;
}

function basicAuth(env) {
  return "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64");
}

async function tokenRequest(env, body) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(env), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    const err = new Error(`Xero token error: ${j.error ?? r.status}`);
    if (j.error === "invalid_grant") err.code = "invalid_grant";
    throw err;
  }
  return j;
}

export const exchangeCode = (env, code) =>
  tokenRequest(env, new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: env.XERO_REDIRECT_URI }));

export const refreshToken = (env, refresh_token) =>
  tokenRequest(env, new URLSearchParams({ grant_type: "refresh_token", refresh_token }));

export async function getTenants(accessToken) {
  const r = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  return r.json();
}

export async function xeroGet(accessToken, tenantId, path) {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": tenantId, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Xero GET ${path}: HTTP ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Implement `scripts/xero-connect.mjs`**

```js
// One-time Xero OAuth sign-in. Opens a local callback server, prints the
// authorize URL, captures the redirect code, stores the encrypted refresh
// token + tenant in xero_connection.  node scripts/xero-connect.mjs
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { xeroEnv, exchangeCode, getTenants, encryptSecret } from "../lib/xero-api.mjs";

const env = xeroEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const port = Number(new URL(env.XERO_REDIRECT_URI).port || 8737);
const scope = "offline_access accounting.transactions.read accounting.contacts.read";
const authUrl = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${env.XERO_CLIENT_ID}&redirect_uri=${encodeURIComponent(env.XERO_REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=portal`;

console.log("\n┌──────────────────────────────────────────────");
console.log("│  Open this URL and sign in as Rocking's Xero admin:");
console.log("│  " + authUrl);
console.log("└──────────────────────────────────────────────\n");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, env.XERO_REDIRECT_URI);
  if (!url.pathname.startsWith("/callback")) { res.writeHead(404).end(); return; }
  const code = url.searchParams.get("code");
  try {
    const tok = await exchangeCode(env, code);
    const tenants = await getTenants(tok.access_token);
    const t = tenants[0];
    const enc = encryptSecret(tok.refresh_token, env.XERO_TOKEN_ENC_KEY);
    await sb.from("xero_connection").upsert({
      id: 1, tenant_id: t.tenantId, tenant_name: t.tenantName,
      token_ciphertext: enc.ciphertext, token_iv: enc.iv, token_tag: enc.tag,
      status: "connected", updated_at: new Date().toISOString(),
    });
    res.writeHead(200, { "Content-Type": "text/html" }).end("<h2>Xero connected. You can close this tab.</h2>");
    console.log(`✓ Connected Xero org "${t.tenantName}" (${t.tenantId}). Run xero-map then xero-pull.`);
  } catch (e) {
    res.writeHead(500).end("error: " + e.message);
    console.error("connect failed:", e.message);
  } finally {
    server.close();
  }
});
server.listen(port, () => console.log(`Waiting for Xero redirect on ${env.XERO_REDIRECT_URI} …`));
```

- [ ] **Step 3: Syntax check + commit**

Run: `node --check lib/xero-api.mjs && node --check scripts/xero-connect.mjs`
Expected: no output.
```bash
git add lib/xero-api.mjs scripts/xero-connect.mjs
git commit -m "feat(xero): API client + one-time OAuth connect script"
```

---

### Task 4: Map + pull scripts

**Files:**
- Create: `scripts/xero-map.mjs`
- Create: `scripts/xero-pull.mjs`

**Interfaces:**
- Consumes: `xeroEnv`/`refreshToken`/`xeroGet`/`decryptSecret`/`encryptSecret` (Task 3); `normalizeInvoice`/`isVisibleStatus`/`summarize` (Task 2).
- Produces: populated `clients.xero_contact_id`, `xero_invoices`, `client_billing`.

- [ ] **Step 1: Implement `scripts/xero-map.mjs`**

```js
// Map a Portal client to a Xero Contact by name.
//   node scripts/xero-map.mjs <clientId> "GSR Law"
import { createClient } from "@supabase/supabase-js";
import { xeroEnv, refreshToken, xeroGet, decryptSecret, encryptSecret } from "../lib/xero-api.mjs";

const [clientId, contactName] = process.argv.slice(2);
if (!clientId || !contactName) { console.error('Usage: node scripts/xero-map.mjs <clientId> "<Contact Name>"'); process.exit(1); }

const env = xeroEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connection").select("*").eq("id", 1).single();
const refreshed = await refreshToken(env, decryptSecret({ ciphertext: conn.token_ciphertext, iv: conn.token_iv, tag: conn.token_tag }, env.XERO_TOKEN_ENC_KEY));
const renc = encryptSecret(refreshed.refresh_token, env.XERO_TOKEN_ENC_KEY);
await sb.from("xero_connection").update({ token_ciphertext: renc.ciphertext, token_iv: renc.iv, token_tag: renc.tag }).eq("id", 1);

const res = await xeroGet(refreshed.access_token, conn.tenant_id, `/Contacts?where=${encodeURIComponent(`Name=="${contactName}"`)}`);
const contact = (res.Contacts ?? [])[0];
if (!contact) { console.error(`No Xero contact named "${contactName}". Check the exact name in Xero.`); process.exit(1); }
await sb.from("clients").update({ xero_contact_id: contact.ContactID }).eq("id", clientId);
console.log(`✓ Mapped client ${clientId} -> Xero contact "${contact.Name}" (${contact.ContactID}). Run: node scripts/xero-pull.mjs ${clientId}`);
```

- [ ] **Step 2: Implement `scripts/xero-pull.mjs`**

```js
// Pull invoices + credit notes for mapped clients into the Portal. Idempotent.
//   node scripts/xero-pull.mjs <clientId>
//   node scripts/xero-pull.mjs --all
import { createClient } from "@supabase/supabase-js";
import { xeroEnv, refreshToken, xeroGet, decryptSecret, encryptSecret } from "../lib/xero-api.mjs";
import { normalizeInvoice, isVisibleStatus, summarize } from "../lib/xero-helpers.mjs";

const arg = process.argv[2];
if (!arg) { console.error("Usage: node scripts/xero-pull.mjs <clientId>|--all"); process.exit(1); }

const env = xeroEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const today = new Date().toISOString().slice(0, 10);

const { data: conn } = await sb.from("xero_connection").select("*").eq("id", 1).maybeSingle();
if (!conn) { console.error("No Xero connection — run xero-connect first."); process.exit(1); }

let access;
try {
  const refreshed = await refreshToken(env, decryptSecret({ ciphertext: conn.token_ciphertext, iv: conn.token_iv, tag: conn.token_tag }, env.XERO_TOKEN_ENC_KEY));
  access = refreshed.access_token;
  const renc = encryptSecret(refreshed.refresh_token, env.XERO_TOKEN_ENC_KEY);
  await sb.from("xero_connection").update({ token_ciphertext: renc.ciphertext, token_iv: renc.iv, token_tag: renc.tag, status: "connected" }).eq("id", 1);
} catch (e) {
  if (e.code === "invalid_grant") { await sb.from("xero_connection").update({ status: "reauth_required" }).eq("id", 1); console.error("✗ Xero token expired — run xero-connect."); process.exit(1); }
  throw e;
}

let q = sb.from("clients").select("id, name, xero_contact_id").not("xero_contact_id", "is", null);
if (arg !== "--all") q = q.eq("id", arg);
const { data: clients } = await q;
if (!clients?.length) { console.error("No mapped clients to pull."); process.exit(0); }

const { data: run } = await sb.from("import_runs").insert({ source: "xero", report_date: today, file_names: [] }).select("id").single();

async function pageAll(path) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await xeroGet(access, conn.tenant_id, `${path}${path.includes("?") ? "&" : "?"}page=${page}`);
    const batch = res.Invoices ?? res.CreditNotes ?? [];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

for (const c of clients) {
  try {
    const rawInv = await pageAll(`/Invoices?where=${encodeURIComponent(`Contact.ContactID==Guid("${c.xero_contact_id}") AND Type=="ACCREC"`)}&Statuses=AUTHORISED,PAID`);
    const rawCn = await pageAll(`/CreditNotes?where=${encodeURIComponent(`Contact.ContactID==Guid("${c.xero_contact_id}") AND Type=="ACCRECCREDIT"`)}`);
    const invoices = [
      ...rawInv.filter((i) => isVisibleStatus(i.Status)).map((i) => normalizeInvoice(i, "invoice")),
      ...rawCn.filter((i) => isVisibleStatus(i.Status)).map((i) => normalizeInvoice(i, "credit_note")),
    ];

    // Replace this client's invoices with the current set.
    await sb.from("xero_invoices").delete().eq("client_id", c.id);
    if (invoices.length) {
      await sb.from("xero_invoices").insert(invoices.map((i) => ({ ...i, client_id: c.id, import_run_id: run.id })));
    }
    const s = summarize(invoices, today);
    await sb.from("client_billing").upsert({
      client_id: c.id, outstanding: s.outstanding, overdue: s.overdue,
      currency: s.currency, as_of: today, updated_at: new Date().toISOString(),
    });
    console.log(`✓ ${c.name}: ${invoices.length} docs, outstanding ${s.currency ?? ""} ${s.outstanding} (${s.overdue} overdue)`);
  } catch (e) {
    console.error(`✗ ${c.name}: ${e.message}`);
  }
}
await sb.from("xero_connection").update({ last_pull_at: new Date().toISOString() }).eq("id", 1);
```

- [ ] **Step 3: Syntax check + commit**

Run: `node --check scripts/xero-map.mjs && node --check scripts/xero-pull.mjs`
Expected: no output.
```bash
git add scripts/xero-map.mjs scripts/xero-pull.mjs
git commit -m "feat(xero): map + pull scripts (invoices + credit notes -> snapshot)"
```

---

### Task 5: Billing view layer

**Files:**
- Create: `lib/views/billing.ts`

**Interfaces:**
- Consumes: `groupInvoices`/`summarize` shape from `lib/xero-helpers.mjs` (Task 2).
- Produces (consumed by Task 6):
  - `BillingInvoice = { id, number, type, status, date, dueDate, total, amountDue, amountPaid, currency }`
  - `ClientBilling = { enabled: boolean; outstanding: number; overdue: number; currency: string|null; asOf: string|null; open: BillingInvoice[]; paid: BillingInvoice[]; creditNotes: BillingInvoice[] }`
  - `getClientBilling(clientId: string) -> Promise<ClientBilling>`

- [ ] **Step 1: Implement `lib/views/billing.ts`**

```ts
import { createClient } from "@/lib/supabase/server";
import { groupInvoices } from "@/lib/xero-helpers.mjs";

export type BillingInvoice = {
  id: string;
  number: string | null;
  type: "invoice" | "credit_note";
  status: string;
  date: string | null;
  dueDate: string | null;
  total: number | null;
  amountDue: number | null;
  amountPaid: number | null;
  currency: string | null;
};

export type ClientBilling = {
  enabled: boolean;
  outstanding: number;
  overdue: number;
  currency: string | null;
  asOf: string | null;
  open: BillingInvoice[];
  paid: BillingInvoice[];
  creditNotes: BillingInvoice[];
};

const EMPTY: ClientBilling = { enabled: false, outstanding: 0, overdue: 0, currency: null, asOf: null, open: [], paid: [], creditNotes: [] };

export async function getClientBilling(clientId: string): Promise<ClientBilling> {
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("xero_contact_id").eq("id", clientId).maybeSingle();
  if (!client?.xero_contact_id) return EMPTY;

  const [{ data: summary }, { data: invoices }] = await Promise.all([
    supabase.from("client_billing").select("outstanding, overdue, currency, as_of").eq("client_id", clientId).maybeSingle(),
    supabase.from("xero_invoices").select("id, number, type, status, date, due_date, total, amount_due, amount_paid, currency").eq("client_id", clientId).order("date", { ascending: false }),
  ]);

  const mapped: BillingInvoice[] = (invoices ?? []).map((i) => ({
    id: i.id, number: i.number, type: i.type as "invoice" | "credit_note", status: i.status,
    date: i.date, dueDate: i.due_date, total: i.total, amountDue: i.amount_due, amountPaid: i.amount_paid, currency: i.currency,
  }));
  const { open, paid, creditNotes } = groupInvoices(
    mapped.map((m) => ({ ...m, amount_due: m.amountDue })),
  ) as { open: BillingInvoice[]; paid: BillingInvoice[]; creditNotes: BillingInvoice[] };

  return {
    enabled: true,
    outstanding: Number(summary?.outstanding ?? 0),
    overdue: Number(summary?.overdue ?? 0),
    currency: summary?.currency ?? mapped[0]?.currency ?? null,
    asOf: summary?.as_of ?? null,
    open, paid, creditNotes,
  };
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add lib/views/billing.ts
git commit -m "feat(xero): billing view layer (getClientBilling)"
```

---

### Task 6: Billing page + conditional nav

**Files:**
- Create: `app/(app)/billing/page.tsx`
- Create: `components/BillingView.tsx`
- Modify: `lib/nav.ts` (add Billing to `client_manager` → Account)
- Modify: `components/AppShell.tsx` (accept `billingEnabled`, filter the item)
- Modify: `app/(app)/layout.tsx` (fetch mapping, pass `billingEnabled`)

**Interfaces:**
- Consumes: `getClientBilling` / `ClientBilling` (Task 5).

- [ ] **Step 1: `components/BillingView.tsx`**

```tsx
import type { ClientBilling, BillingInvoice } from "@/lib/views/billing";
import { Card, CardHeader } from "@/components/ui";

function money(n: number | null, ccy: string | null): string {
  if (n == null) return "—";
  return `${ccy ?? ""} ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

function Rows({ invoices, today }: { invoices: BillingInvoice[]; today: string }) {
  if (invoices.length === 0) return <p className="px-4 py-3.5 text-sm text-muted">Nothing here.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
        <tr><th className="px-4 py-2.5">Invoice</th><th className="px-4 py-2.5">Date</th><th className="px-4 py-2.5">Due</th><th className="px-4 py-2.5 text-right">Amount</th></tr>
      </thead>
      <tbody>
        {invoices.map((i) => {
          const overdue = (i.amountDue ?? 0) > 0 && i.dueDate != null && i.dueDate < today;
          return (
            <tr key={i.id} className="border-b border-line-soft last:border-0">
              <td className="px-4 py-2.5 font-medium text-ink">{i.number ?? "—"}</td>
              <td className="px-4 py-2.5 text-muted">{i.date ?? "—"}</td>
              <td className={`px-4 py-2.5 ${overdue ? "font-semibold text-brand" : "text-muted"}`}>{i.dueDate ?? "—"}{overdue ? " · overdue" : ""}</td>
              <td className="px-4 py-2.5 text-right font-medium text-ink">{money((i.amountDue ?? 0) > 0 ? i.amountDue : i.total, i.currency)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function BillingView({ billing, today }: { billing: ClientBilling; today: string }) {
  return (
    <div className="space-y-5">
      <Card className="p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">Outstanding balance</p>
        <p className="mt-1 text-[30px] font-bold text-ink">{money(billing.outstanding, billing.currency)}</p>
        <p className="mt-1 text-sm text-muted">
          {billing.overdue > 0 ? <span className="font-semibold text-brand">{money(billing.overdue, billing.currency)} overdue · </span> : null}
          {billing.asOf ? `as of ${billing.asOf}` : ""}
        </p>
      </Card>

      <Card>
        <CardHeader title="Open invoices" count={billing.open.length} />
        <Rows invoices={billing.open} today={today} />
      </Card>

      {billing.creditNotes.length > 0 && (
        <Card>
          <CardHeader title="Credit notes" count={billing.creditNotes.length} />
          <Rows invoices={billing.creditNotes} today={today} />
        </Card>
      )}

      <Card>
        <CardHeader title="Paid" count={billing.paid.length} />
        <Rows invoices={billing.paid} today={today} />
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: `app/(app)/billing/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getClientBilling } from "@/lib/views/billing";
import { BillingView } from "@/components/BillingView";
import { PageHeader } from "@/components/ui";

export default async function BillingPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const billing = await getClientBilling(me.profile.client_id);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" subtitle="Your invoices and account balance with Rocking." />
      {billing.enabled ? (
        <BillingView billing={billing} today={today} />
      ) : (
        <p className="text-sm text-muted">Billing isn&apos;t set up for your account yet.</p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add Billing to `lib/nav.ts`** (in `client_manager` → "Account", before Quotes)

```ts
    {
      label: "Account",
      items: [
        { label: "Billing", href: "/billing" },
        { label: "Quotes", href: "/quotes" },
        { label: "Team", href: "/team" },
      ],
    },
```

- [ ] **Step 4: Make the item conditional in `components/AppShell.tsx`**

Add `billingEnabled` to the props type and compute filtered groups. Replace the `const groups = NAV[role];` line with:

```tsx
  const groups = billingEnabled
    ? NAV[role]
    : NAV[role].map((g) => ({ ...g, items: g.items.filter((i) => i.href !== "/billing") }));
```

And add `billingEnabled = false` to the destructured props (with `billingEnabled?: boolean` in the type).

- [ ] **Step 5: Pass the flag from `app/(app)/layout.tsx`**

In the layout's client query, also select `xero_contact_id`, and pass `billingEnabled` to `AppShell`:

```tsx
      supabase.from("clients").select("name, xero_contact_id").eq("id", me.profile.client_id).maybeSingle(),
```
…then `const billingEnabled = !!client?.xero_contact_id;` and add `billingEnabled={billingEnabled}` to the `<AppShell ... />` props. (For a client with no `client_id`, default false.)

- [ ] **Step 6: Build + commit**

Run: `npm run build`
Expected: compiles; `/billing` in the route list.
```bash
git add "app/(app)/billing/page.tsx" components/BillingView.tsx lib/nav.ts components/AppShell.tsx "app/(app)/layout.tsx"
git commit -m "feat(xero): client Billing page + conditional nav (mapped clients only)"
```

---

### Task 7: Nightly schedule + GSR pilot verification

**Files:**
- Create: `~/Library/LaunchAgents/com.rocking.xero-pull.plist`

- [ ] **Step 1: Wire credentials + connect Xero (one-time)**

Add the Pre-flight env vars to `.env.local`, then:
Run: `node scripts/xero-connect.mjs` — open the printed URL, sign in as Rocking's Xero admin, approve.
Expected: `✓ Connected Xero org "Rocking (Pty) Ltd" (...)`.

- [ ] **Step 2: Map + pull GSR**

Run: `node scripts/xero-map.mjs 9f0cfd10-c1f6-4cae-8bf0-39e61d287d48 "GSR Law"`
Then: `node scripts/xero-pull.mjs 9f0cfd10-c1f6-4cae-8bf0-39e61d287d48`
Expected: `✓ GSR Law: N docs, outstanding ZAR … ` — confirm the outstanding total and that INV-2766 (R50,361.95, due 2026-07-01) appears.

- [ ] **Step 3: Verify the snapshot + RLS**

Run a service-role query to confirm `xero_invoices` for GSR are all `AUTHORISED`/`PAID` (no drafts) and `client_billing` outstanding matches Xero; and an anon read of `xero_invoices` returns 0 rows. Expected: status set ⊆ {AUTHORISED, PAID}; anon rows = 0.

- [ ] **Step 4: Eyeball the page**

`npm run dev`, sign in as a GSR manager (or impersonate), open `/billing`: balance + "as of" today, open/paid/credit-note tables, INV-2766 shown as open & overdue-or-not per its due date. Confirm a non-GSR/un-mapped client sees no Billing tab.

- [ ] **Step 5: Install the nightly agent**

Create `~/Library/LaunchAgents/com.rocking.xero-pull.plist` (mirrors the M365 agent), running `/Users/shawnjooste/.local/bin/node /Users/shawnjooste/Documents/Claude/dashboard-v2/scripts/xero-pull.mjs --all` at 02:45, logging to `~/Library/Logs/rocking-xero-pull.log`, no secrets in the plist:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.rocking.xero-pull</string>
  <key>ProgramArguments</key><array>
    <string>/Users/shawnjooste/.local/bin/node</string>
    <string>/Users/shawnjooste/Documents/Claude/dashboard-v2/scripts/xero-pull.mjs</string>
    <string>--all</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/shawnjooste/Documents/Claude/dashboard-v2</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>45</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>/Users/shawnjooste/Library/Logs/rocking-xero-pull.log</string>
  <key>StandardErrorPath</key><string>/Users/shawnjooste/Library/Logs/rocking-xero-pull.log</string>
</dict></plist>
```
Load + test: `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.rocking.xero-pull.plist && launchctl kickstart -k gui/$(id -u)/com.rocking.xero-pull`, then confirm the log shows the GSR pull.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore(xero): nightly launchd schedule + GSR pilot verified"
```

---

## Self-Review

- **Spec coverage:** connection (Task 3), per-client mapping/opt-in (Tasks 1, 4, 6), nightly pull + snapshot (Task 4, 7), Billing page with balance/open/paid/credit-notes + "as of" (Tasks 5, 6), AUTHORISED/PAID-only guardrail (Task 2 `isVisibleStatus`, enforced in pull Task 4 + asserted Task 7), RLS client-own + staff (Task 1, verified Task 7), conditional nav (Task 6). PDF download is correctly deferred to Slice 2 (spec). All Slice-1 spec items map to a task. ✓
- **Placeholder scan:** none — every step has full code/commands. The one external dependency (a registered Xero OAuth app) is in Pre-flight with exact env keys. ✓
- **Type consistency:** `normalizeInvoice` output keys (`xero_invoice_id, number, type, status, date, due_date, total, amount_due, amount_paid, currency`) match the `xero_invoices` columns (Task 1) and the pull insert (Task 4); `summarize` returns `{outstanding, overdue, currency, openCount}` used in Task 4; `getClientBilling` → `ClientBilling` consumed by `BillingView`/page (Tasks 5–6); `groupInvoices` keys `{open, paid, creditNotes}` consistent across Tasks 2/5. ✓
- **Note:** `getClientBilling` adapts `BillingInvoice` (camelCase `amountDue`) to the helper's expected `amount_due` before `groupInvoices`; both pull and view share the one `xero-helpers.mjs`, so the snake/camel boundary is handled in the view only.
