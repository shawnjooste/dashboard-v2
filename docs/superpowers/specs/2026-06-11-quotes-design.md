# Quotes — design

**Status:** approved (Shawn, 2026-06-11). Build slice 1 now; admin builder UI is slice 2.

## Goal

Replace the manual quoting workflow. Quotes live in the portal per client; client
managers view them (template-faithful A4 document, browser print-to-PDF), and
accept / request changes / decline. Email notifications via Resend both ways.
Creation in slice 1 is the **co-work path**: Shawn pastes a supplier quote in chat,
Claude produces the quote document + internal supplier costs, and inserts it via
`scripts/create-quote.mjs` (service role). Slice 2 adds an admin builder form
(port of the template's edit mode).

## Decisions (locked with Shawn)

- **Versioning:** amend = new immutable version of the *same* quote number;
  client managers see the latest version only; staff see full history.
  Accepted/rejected quotes lock (no further versions).
- **Visibility:** client managers only. Members see nothing.
- **Acceptance:** any manager, first click wins (atomic guard). Actions:
  Accept / Request changes (comment required) / Decline (comment optional).
- **Margin:** supplier cost captured **per line item**, in a staff-only table —
  never in the client-readable document.
- **Numbering:** sequential per year — `Q-2026-007` — via an atomic counter.
- **Expiry:** derived at read time from the version's valid-until date; an
  expired `sent` quote renders as Expired and cannot be accepted. No cron.
- **PDF:** none server-side. The quote page is print-styled; browser print
  yields the existing template's A4 output.
- **After acceptance:** manual processing for now. The doc JSON + totals are
  shaped to seed Paystack invoicing / projects later.

## Storage (approach A — JSONB document per version)

The template (`quote-data.js`) defines the document shape: company block, client
block (name, address lines, attention), meta (number, date, valid until,
prepared by), projectTitle, projectIntro, sections[] → groups[] → items[]
(description, detail, qty, unitPrice, usageNote/totalNote for usage-based
lines), per-section totalLabel, summaryNote, terms[], banking, vatPercent.
Normalized tables would fight this shape; rendered-HTML storage would kill
analytics. Each version stores the doc as JSONB plus denormalized totals.

### Tables (migration 0022)

- `quote_counters(year int pk, last_n int)` + `next_quote_number()`
  SECURITY DEFINER — atomic upsert/increment, returns `Q-<year>-<NNN>`.
- `quotes`: id, client_id FK, quote_number unique, title, status
  (`draft | sent | accepted | rejected | changes_requested`), current_version,
  created_by FK profiles, created_at, updated_at.
- `quote_versions`: id, quote_id FK, version, doc jsonb, subtotal, vat_amount,
  grand_total, monthly_total, valid_until date, created_at;
  unique (quote_id, version). Immutable once sent.
- `quote_internal`: id, version_id FK, line_path text (e.g. `s0.g1.i0`),
  supplier_cost numeric, note. **Staff-only RLS** — the privacy boundary is the
  table, not a convention.
- `quote_events`: id, quote_id FK, version, event
  (`created | sent | viewed | accepted | rejected | changes_requested`),
  actor_profile_id, comment, created_at. Append-only audit; `viewed` logged
  once per manager; acceptance references the exact version.

### RLS

- `quotes`: staff all; managers select own client's rows where status ≠ draft.
- `quote_versions`: staff all; managers select only `version = current_version`
  of visible quotes.
- `quote_internal`: staff only.
- `quote_events`: staff all; managers select events of visible quotes (feeds
  the "Accepted by Gail on …" banner).
- Decisions write through **server actions using the service client** with
  explicit guards (manager role, client match, status = sent, not expired) and
  an atomic `update … eq(status,'sent')` — first click wins by construction.

## Pure logic (`lib/quotes/doc.ts`, unit-tested)

`QuoteDoc` type; `computeTotals(doc)` (per-section subtotal/VAT/grand, skips
usage-based null lines, flags the `recurring` section as monthly);
`fmtMoney` (R 1 234,56 en-ZA); `isExpired(validUntil)`; `linePath` helpers.

## Rendering

`components/QuoteDocument.tsx` (server) + CSS module porting the template's A4
styles: header (logo + company meta), parties, red-edged meta block, project
block, per-section line tables with group rows and the accent grand-total row,
cost summary with dotted leaders, terms, banking, footer. Read-only twin of the
template. Print CSS in the module + `print:hidden` on the app shell chrome →
browser print = the current PDF output.

## Client surface (managers)

- Nav: **Quotes** added to the manager Account group.
- `/quotes`: list — number, title, status pill (incl. derived Expired), grand
  total, valid until.
- `/quotes/[id]`: status banner (who/when/comment once decided), action bar
  (Accept with confirm dialog stating number + incl-VAT total + client name;
  Request changes with required comment; Decline with optional comment; Print),
  then `QuoteDocument`. First page view per manager logs a `viewed` event.
- `app/(app)/quotes/[id]/actions.ts`: `acceptQuote`, `declineQuote`,
  `requestChanges` — guards + atomic update + event + emails.

## Admin surface (staff)

- `/admin/clients/[id]/quotes`: list with status, totals, margin.
- `/admin/quotes/[id]`: current document, version history, events timeline,
  internal margin panel (supplier cost vs price per line, totals).
- "Quotes →" action added on the client drill-in header.

## Emails (Resend, pattern of `lib/notify.ts`)

- **Quote sent** → every active manager of the client: subject
  "New quote from Rocking — Q-2026-007: <title>", link to `/quotes/[id]`.
- **Decision** (accepted / declined / changes requested) → shawn@rocking.one +
  all managers: actor, time, comment. Email failures never block the decision —
  the event row is the source of truth.

## Creation flow (slice 1, co-work)

`scripts/create-quote.mjs <file.json>`: input `{ clientId | clientName, title,
doc, internal: [{ path, supplierCost, note? }] }` → computes totals, allocates
the number via `next_quote_number()`, inserts quote (status sent) + version 1 +
internal rows + `created`/`sent` events, sends the manager emails, prints the
quote URL. Amendments: `--amend <quoteId>` inserts version N+1, resets status
to sent, re-notifies.

## Out of scope (slice 2+)

Admin quote-builder form (template edit-mode port), supplier-quote file
attachments, Paystack invoice conversion, project creation from accepted
quotes, client-visible version history.

## Verification

Unit tests for doc math (incl. usage-based lines), number formatting, expiry.
`tsc`, eslint, vitest, `next build`. Live: create a real test quote for GSR Law,
view as a manager, exercise accept + decline + amend, confirm both email
directions, print output matches the template.
