# Quote API

A scoped REST API over the quote service so the team and Hermes can draft and
amend quotes without holding the Supabase service-role key. Design spec:
`docs/superpowers/specs/2026-08-13-quote-api-design.md`.

**The gate: nothing sent through this API reaches a customer.** There is no
send endpoint — `POST /quotes` and `.../amend` only ever produce
`draft`/`pending_review`. Every quote created here lands in `pending_review`
and a human reviews and sends it from the portal. That review notification
goes to `shawn@rocking.one` and `kelle@rocking.one` (cc `accounts@`) — staff,
never the client.

## Auth

Every request needs `Authorization: Bearer rq_live_…`.

Keys are minted by Shawn (or another operator with service-role access)
using `scripts/api-key.mjs`:

```sh
node scripts/api-key.mjs mint "Hermes"                       # no linked profile
node scripts/api-key.mjs mint "Kelle" --profile kelle@rocking.one
node scripts/api-key.mjs list
node scripts/api-key.mjs revoke <key-id>
```

`mint` prints the raw key **once** — copy it immediately, it is never shown
again (only its sha256 hash is stored, so it cannot be retrieved later, only
revoked). If you lose it, mint a new one and revoke the old.

A missing, unknown, or revoked key all return the same `401` — the API never
reveals whether a key exists but was revoked.

There is one capability level. Every key can create and amend; no key can
send. This isn't a scope you can misconfigure — the send capability simply
doesn't exist over HTTP.

## Endpoints

All under `/api/v1/`.

| Method & path | Purpose |
| --- | --- |
| `GET /api/v1/clients?search=` | Resolve a name → candidate clients. Read-only, never creates. |
| `POST /api/v1/quotes` | Create a quote. Always lands in `pending_review`. |
| `GET /api/v1/quotes/{id}` | Status + totals lookup. |
| `POST /api/v1/quotes/{id}/amend` | New version of an existing quote. Always back to `pending_review`. |

### `GET /api/v1/clients?search=`

Resolves a client name to an id — this is how you find the `clientId` (or
just pass a `client` name straight into create/amend and let the route
resolve it for you). Read-only: it never creates a client. New clients are a
human decision (Shawn), out of scope for this API.

`search` must be at least 2 characters.

```sh
curl -H "Authorization: Bearer rq_live_…" \
  "https://portal.rocking.one/api/v1/clients?search=sun%20destinations"
```

```json
[
  { "id": "…", "name": "Sun Destinations", "quotePrefix": "SUN" }
]
```

### `POST /api/v1/quotes`

Creates a quote. The server owns everything structural — company block,
banking, VAT percent, standard terms, section layout, validity default.
Callers supply only the varying parts: client, title, items, and a little
prose.

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

Response — `201 Created` (or `200` on an idempotency replay, see below):

```json
{
  "quoteId": "…",
  "quoteNumber": "QU-SUN-002",
  "version": 1,
  "status": "pending_review",
  "replayed": false,
  "totals": { "exVat": 2643.85, "vat": 396.58, "inclVat": 3040.43, "monthlyInclVat": null },
  "adminUrl": "https://portal.rocking.one/admin/quotes/…"
}
```

`adminUrl` is what you paste back to a human: "built, waiting for your
review."

Field notes:

- **`client` vs `clientId`.** `client` is a name — exactly one
  case-insensitive substring match proceeds; several matches → `409` with a
  `candidates` list; none → `404`. An explicit `clientId` (uuid) skips
  resolution entirely. Either `client` or `clientId` is required.
- **`items[].supplierCostExVat` XOR `items[].unitPriceExVat`** — exactly one
  of the two, every item, or `422`. See the markup rule below.
- **`items[].monthly: true`** routes that item into a recurring/monthly
  section, billed separately from the once-off section. The assembler only
  builds a section when it has items.
- **`attention`** defaults from the client's billing contact name; address
  lines default from the client's stored physical address.
- **`validUntil`** defaults to today + 14 days (`yyyy-mm-dd`). **`intro`**
  defaults to a generated line naming the title and VAT basis.
- **`extraTerms`** are appended after the four standard terms. The standard
  set always appears and cannot be removed or reordered. When `checkout` is
  `true` the payment term becomes card-payment wording (and the banking
  block is suppressed at render).
- **`Idempotency-Key` header** (optional): send the same value on a retried
  create and you get the original quote back unchanged, with
  `"replayed": true` and a `200` instead of `201`.

### `GET /api/v1/quotes/{id}`

```
GET /api/v1/quotes/{id}
```

```json
{
  "quoteNumber": "QU-SUN-002",
  "status": "pending_review",
  "version": 1,
  "totals": { "exVat": 2643.85, "vat": 396.58, "inclVat": 3040.43, "monthlyInclVat": null },
  "portalUrl": "https://portal.rocking.one/quotes/…",
  "adminUrl": "https://portal.rocking.one/admin/quotes/…"
}
```

No internal costs (`quote_internal`) are ever exposed here — this route is
safe to hand a fully client-price view to.

### `POST /api/v1/quotes/{id}/amend`

Same body shape as create, minus the create-time fields (`client`,
`clientId`, `checkout`, `billingStartsNextMonth` — a quote's client and
checkout mode don't change on amend). Amend **replaces** the document's
varying parts wholesale; it is not a patch — send the full item list you
want, not just the changed line.

```json
{
  "title": "Windows 11 Pro Licence",
  "items": [{
    "description": "Microsoft Windows 11 Professional — Licence",
    "detail": "One licence, supplied with its activation key.",
    "qty": 1,
    "supplierCostExVat": 2500,
    "monthly": false
  }],
  "summaryNote": "Supply of the licence and key only.",
  "extraTerms": ["Licence keys are non-refundable once issued."]
}
```

Response:

```json
{
  "quoteId": "…",
  "quoteNumber": "QU-SUN-002",
  "version": 2,
  "status": "pending_review",
  "totals": { "exVat": 2875.00, "vat": 431.25, "inclVat": 3306.25, "monthlyInclVat": null },
  "adminUrl": "https://portal.rocking.one/admin/quotes/…"
}
```

Amend always lands back in `pending_review` — even a quote that was already
`sent` is pulled back for re-review, never left live under a stale document.
That's enforced in the service layer, not just this route.

## The markup rule (get this right every time)

**Client price (ex VAT) = supplier cost (incl VAT).** Each item carries
*exactly one* of two fields — never both, never neither:

- **`supplierCostExVat`** — what you pay the supplier, ex VAT, per unit. The
  server computes `unitPrice = round2(cost × 1.15)` and records the cost in
  `quote_internal` (staff-only, never in any API response) with an
  auto-generated note naming the API key and the arithmetic.
- **`unitPriceExVat`** — the client-facing price ex VAT, used as-is. Supplier
  cost is recorded as unknown. Use this when you already know the client
  price and don't want the server doing markup math (e.g. a fixed retail
  price, or a service with no supplier cost).

**Worked example:** supplier cost R2,299 ex VAT →
`unitPrice = round2(2299 × 1.15) = 2643.85` ex VAT. That's the number in the
`items[].supplierCostExVat: 2299` example above, and it's exactly the number
that shows up as `totals.exVat` on a single-item, qty-1 quote.

This exists to kill the "is R2,299 your cost or their price?" ambiguity —
naming the field removes the guess.

Lines priced with `unitPriceExVat` record no supplier cost, so the admin
margin figure on mixed quotes counts all revenue but only the recorded
costs — reviewers should treat margin on mixed quotes as an upper bound.

## Errors

One shape: `{ "error": "…" }`, with extra detail on some codes.

| Status | When | Extra fields |
| --- | --- | --- |
| `400` | Malformed JSON body. | — |
| `401` | Missing, unknown, or revoked API key — indistinguishable by design. | — |
| `404` | Unknown quote id, or a `client`/`clientId` with no match. | — |
| `405` | Wrong HTTP method for the path (e.g. `DELETE /api/v1/quotes`). No route defines a handler for it, so the framework's default 405 applies. | — |
| `409` | `client` name matched more than one client. **Resolve it:** pick the candidate you meant from `candidates` and retry using its `id` as `clientId` instead of `client`. If the client you want isn't in the list, stop — new clients are created by Shawn, not this API. | `candidates: [{ id, name }]` |
| `422` | Field validation failed (cost XOR price, `qty ≥ 1`, non-empty items, malformed `validUntil`, client has no `quote_prefix` set), or the service layer rejected the request (e.g. no priced line items). | `details: [{ field, message }]` on validation failures |
| `500` | Unhandled server error. | — |

## Testing / verification

- Unit and integration tests cover the doc assembler (markup arithmetic,
  XOR validation, monthly routing, the golden QU-SUN-002 fixture), auth
  (hash lookup, revoked-key parity, `last_used_at` stamping), the
  pending-review gate (asserted on the mocked email layer — no client
  address ever appears), and the four routes (one test per error class).
  Run with `npx vitest run`.
- Stubs don't see database CHECK constraints. Before any real key is handed
  out, a manual pass runs create/get/amend against a scratch `QU-ZZZ-…`
  client on the live database, confirms `pending_review`, the review email,
  and the version bump on amend, then deletes every scratch row it made.
  That pass is recorded in
  `.superpowers/sdd/2026-08-13-quote-api/task-6-report.md`.

## Out of scope (v1)

Sending over HTTP, scopes, rate limiting, a key-management UI, and client
creation over HTTP are all deliberately absent — see the design spec's "Out
of scope" section for the reasoning and what would have to change to add
each one.
