# Quote API — design

**Date:** 2026-08-13
**Status:** approved
**Scope:** a scoped REST API over `lib/quotes/service.ts` so the team and Hermes can draft
and amend quotes without being able to email a client.

## Why

The service layer (spec: `2026-08-13-quote-service-layer-design.md`) made quoting safe to
delegate, but only for callers that can import TypeScript from this repo. The team's browsers
and Hermes cannot. The only credential that would let them quote today is the Supabase
service-role key — unrestricted read/write on every client's data. This API is the smaller
credential.

**The product intent, in the owner's words:** the team says *"Quote Interland on XYZ at
R123"*. The layout, template, boilerplate and all email functions stay inside the Portal.

## Decisions taken (with the reasoning that binds implementation)

1. **Callers supply the varying parts only — never the full QuoteDoc.** The server owns the
   company block, banking, VAT percent, standard terms, section layout and validity default.
   The boilerplate is exactly where an agent would introduce a silent error onto a
   client-facing document, and it has no legitimate reason to vary per quote.
2. **Structured prose, not free-form documents.** Callers may supply an intro, a summary
   note, extra terms (appended — never replacing or reordering the standard set), and a
   detail line per item. Real quotes need per-quote reasoning ("no router included",
   "public IP included"); they do not need structural control.
3. **Client resolution never creates.** Every duplicate-tenant incident to date (Nova Nexus,
   SRTS, Terrafirma) came from creating a client without checking for an existing one. New
   clients remain a human decision.
4. **Create + amend, no send.** Nothing reaches a customer through this API because no route
   sends. That is a stronger guarantee than a scope check: the capability does not exist
   over HTTP. Amend exists because review needs it — Tim creates, Kelle corrects the price —
   and every amend lands back in `pending_review`.
5. **`canSend` is hardcoded false — not a column, not a scope.** With one capability level
   there is nothing to vary; a scopes array every key sets identically is decoration that
   invites misplaced trust. When a send endpoint is ever added, that is the moment scopes
   arrive, as a migration.
6. **Costs are named, not inferred.** Each item carries exactly one of `supplierCostExVat`
   or `unitPriceExVat`. The markup rule (client price ex VAT = supplier cost incl VAT) lives
   in the server. This removes the "is R2,299 your cost or their price?" ambiguity — a real
   R400 difference on a real quote this very day — at the point of writing.

## Auth

New table `api_keys`:

```sql
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                 -- audit label, e.g. "Hermes", "Kelle"
  key_hash     text not null unique,          -- sha256 of the full key
  key_prefix   text not null,                 -- first 12 chars, for listing only
  profile_id   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
-- RLS enabled, no policies: service-role only, like quote_prefix_counters.
```

- Key format: `rq_live_` + 32 random url-safe chars. Shown once at mint, never stored.
- Lookup: sha256(presented key) → indexed equality on `key_hash`. Revoked or missing key
  → the same 401; the API never reveals that a key exists but is revoked.
- Every request stamps `last_used_at` (best-effort; a failed stamp never fails the request).
- Actor mapping, fixed: `{ id: key.profile_id, label: key.name, canSend: false }`.
  `profile_id` makes the audit trail read "Kelle" instead of "an API key"; Hermes' key has
  a null profile and the label carries the identity.
- Minting/revoking keys is a small CLI script (`scripts/api-key.mjs mint|revoke|list`),
  service-role, owner-run. No key-management UI in v1.

## Endpoints

All under `/api/v1/`, all requiring `Authorization: Bearer rq_live_…`.

| Route | Purpose |
| --- | --- |
| `GET /api/v1/clients?search=` | Resolve a name → `[{ id, name, quotePrefix }]`. Read-only, never creates. |
| `POST /api/v1/quotes` | Create → always `pending_review`. Supports `Idempotency-Key` header. |
| `GET /api/v1/quotes/{id}` | `{ quoteNumber, status, version, totals, portalUrl, adminUrl }`. No internal costs in the response. |
| `POST /api/v1/quotes/{id}/amend` | New version → back to `pending_review`. |

### Create request body

```json
{
  "client": "Sun Destinations",
  "title": "Windows 11 Pro Licence",
  "items": [{
    "description": "Microsoft Windows 11 Professional — Licence",
    "detail": "One licence, supplied with its activation key.",
    "qty": 1,
    "supplierCostExVat": 2299,
    "monthly": false
  }],
  "intro": null,
  "summaryNote": "Supply of the licence and key only.",
  "extraTerms": ["Licence keys are non-refundable once issued."],
  "attention": null,
  "validUntil": null,
  "checkout": false,
  "billingStartsNextMonth": false
}
```

- `client`: a name. Exactly one case-insensitive match proceeds; several → 409 listing the
  candidates; none → 404. An explicit `clientId` uuid is also accepted and skips resolution.
- `items[].supplierCostExVat` XOR `items[].unitPriceExVat` — 422 if both or neither.
  Supplier cost path: `unitPrice = round2(cost × 1.15)`; the cost lands in `quote_internal`
  with an auto-generated note naming the API key and the arithmetic. Client-price path:
  used as-is; supplier cost recorded as unknown.
- `items[].monthly: true` routes the item into a recurring section (billed monthly); the
  assembler builds the once-off and/or recurring sections only when they have items.
- `attention` defaults from `client_company_details.billing_contact_name`, else blank.
  Address lines default from `client_company_details.physical_address`.
- `validUntil` defaults to today + 14 days. `intro` defaults to a generated line naming the
  title and VAT basis.
- `extraTerms` are appended after the standard terms. The standard set always appears and
  cannot be removed or reordered. When `checkout` is true the standard payment term is the
  card wording (the banking block is suppressed on checkout quotes at render).
- `Idempotency-Key` header maps to the service's `idempotencyKey`; a replayed create
  returns the original quote with `"replayed": true`.

### Amend request body

Same shape minus `client`/`clientId`/`checkout`/`billingStartsNextMonth` (create-time
concepts). Amend replaces the document's varying parts wholesale — it is not a patch — and
returns `{ version, status: "pending_review" }`.

### Response on create/amend

```json
{ "quoteId": "…", "quoteNumber": "QU-SUN-002", "version": 1, "status": "pending_review",
  "replayed": false, "totals": { "exVat": 2643.85, "vat": 396.58, "inclVat": 3040.43,
  "monthlyInclVat": null }, "adminUrl": "https://portal.rocking.one/admin/quotes/…" }
```

The create response's `adminUrl` is what a caller pastes to a human: "built, waiting for
your review". The review notification to shawn@/kelle@ (cc accounts@) is sent by the
service, not the route.

## Architecture

```
route handler (thin)            lib/quotes/api-input.ts (pure)      existing
  auth: key → Actor        →      validate + assemble QuoteDoc  →   makeQuoteService(sb)
  JSON in/out, status codes       markup arithmetic                  .create / .amend
```

- `lib/api/auth.ts` — key hashing, lookup, Actor mapping. `server-only` is fine here (routes
  are Next-only); the assembler is marker-free pure so it can be unit-tested and reused.
- `lib/quotes/api-input.ts` — the doc assembler: API input + client record + template →
  `CreateQuoteInput`. Pure; the template constants (company block, banking, standard terms)
  move here from `scripts/create-quote.mjs`'s orbit and become the single source.
- Route handlers contain no quote rules. Anything else recreates the drift the service
  layer removed.

## Errors

One shape: `{ "error": "…" }` (+ `"candidates"` on 409, + field detail on 422).

- 401 — missing/unknown/revoked key, indistinguishable by design.
- 404 — unknown quote id; client name with no match ("no client matching 'X' — new clients
  are created by Shawn, or check the spelling").
- 409 — ambiguous client name, with candidates.
- 422 — field validation (cost XOR price, qty ≥ 1, items non-empty, null `quote_prefix` on
  the client, malformed body) and service-level `{ok:false}` results passed through.
- 405/400 for method/JSON errors. No rate limiting in v1: keys are held by the team and
  Hermes, revocation is the control, `last_used_at` is the tripwire.

## Testing

- **Doc assembler (pure): the heavy tests.** Golden test anchored on QU-SUN-002: a
  committed fixture pairs an API input (prose fields supplied verbatim) with the expected
  document, verified once by side-by-side comparison against the real QU-SUN-002 — company
  block, banking, section structure and totals must match exactly; dates and quote number
  are parameterised. Generated defaults (intro when null, validity, attention fallback)
  are asserted in their own cases rather than through the golden doc, since the
  hand-written quote's prose predates the assembler. Markup arithmetic exhaustively,
  including rounding edges (e.g. 2299 → 2643.85). XOR validation, monthly routing,
  extraTerms append-only, checkout term swap.
- **Auth:** hash lookup, revoked → 401 identical to unknown, `last_used_at` stamped,
  Actor mapping (profile vs null-profile keys).
- **The gate, positively:** with the email layer mocked, an API-created quote produces a
  review notification to shawn@/kelle@ (cc accounts@) and **no client address anywhere** —
  asserted on the mock's calls, never by absence of an env var (the Task 6 lesson).
- **Route integration:** stubbed Supabase per the service-test pattern; one test per error
  class.
- **Manual pass before any key is handed out:** mint a test key, curl create/get/amend
  against a scratch `QU-ZZZ` client on the live database, verify `pending_review`, the
  review email, and the amend version bump; revoke the key, delete the scratch rows. Stubs
  do not see CHECK constraints — this pass is what does.

## Out of scope (deliberately)

- Send over HTTP, scopes, rate limiting, key-management UI — arrive together if/when a
  send endpoint is ever justified.
- Client creation over HTTP (a separately-scoped endpoint is the eventual shape if the
  resolve-only friction proves frequent).
- The MCP wrapper for Hermes: a thin tool layer over these routes, built after the REST
  surface has met real requests.
- Portal amend UI: noted gap (reviewers currently cannot amend in the portal; the API and
  CLI can). Its own small project.

## Sequencing

1. `api_keys` migration + `scripts/api-key.mjs` (mint/revoke/list).
2. `lib/quotes/api-input.ts` assembler + golden/markup tests.
3. `lib/api/auth.ts` + the four routes + integration tests.
4. Manual live pass with a scratch key and client; then mint real keys (Hermes, Tim, Kelle).
