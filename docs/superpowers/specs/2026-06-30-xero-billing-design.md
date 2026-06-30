# Xero Billing — Client-Facing Billing in The Portal

**Date:** 2026-06-30
**Status:** Draft design, pending review
**Project:** Rocking One Client Portal (dashboard-v2)

## Vision

Pull each client's billing from Xero into the Portal and show it to them in a new
**client-facing Billing** section: what they owe, their open and paid invoices, credit notes,
and a one-click invoice PDF. Mirrors the existing M365 integration (one encrypted OAuth
connection, per-client mapping, nightly snapshot).

## Decisions (from brainstorm)
- **Audience:** client-facing — a `client_manager` sees their own company's billing. Staff see
  all (via RLS). Members do not.
- **Content:** outstanding balance + open invoices; paid/invoice history; credit notes; on-demand
  invoice **PDF download**. The Billing page itself is the account statement (Xero has no clean
  statement-PDF API, so it's rendered, not fetched).
- **Freshness:** **nightly snapshot** with an honest "as of [date]" label. (Invoice **PDFs are
  fetched live on click**, not snapshotted — they're large and rarely change.)
- **Opt-in:** only clients **mapped to a Xero Contact** get a Billing tab — this is the "specific
  clients" control.

## Validation (live Xero, 2026-06-30)
Confirmed against the connected org (Rocking (Pty) Ltd, ZAR): per-client invoices carry number,
amount due, due date, overdue days, currency, and an `invoice_id` (→ PDF). Portal client names
match Xero Contact names (e.g. "GSR Law" → INV-2766, R50,361.95, due 2026-07-01).

## Architecture (mirrors M365)

- **`xero_connection`** (single row, Rocking's org) — OAuth2; refresh token encrypted at rest with
  the existing AES-GCM helpers (`encryptSecret`/`decryptSecret`), keyed by a dedicated
  `XERO_TOKEN_ENC_KEY`. Scopes: `accounting.transactions.read`, `accounting.contacts.read`,
  `offline_access`. Connected once via an OAuth auth-code sign-in (the connect script catches the
  redirect; same one-time-admin-action shape as the M365 device login). Tracks `status`
  (`connected` / `reauth_required`) and `last_pull_at`.
- **`clients.xero_contact_id`** (nullable) — maps a Portal client to its Xero Contact. Set by
  name-match-then-confirm or manual link. Null = no Billing tab, skipped by the pull.
- **`xero_invoices`** — per client: `client_id`, `xero_invoice_id`, `number`, `type`
  (`invoice` | `credit_note`), `status`, `date`, `due_date`, `total`, `amount_due`, `amount_paid`,
  `currency`, `import_run_id`, timestamps. Unique on `xero_invoice_id`.
- **`client_billing`** (summary, one row per mapped client) — `outstanding`, `overdue`,
  `as_of` (snapshot date), `currency`. Computed from invoices each pull for fast page loads.
- **Nightly pull** — `scripts/xero-pull.mjs --all` (mirrors `m365-pull.mjs`): refresh the token →
  for each client with a `xero_contact_id`, pull that Contact's invoices + credit notes via the
  Xero Accounting API (`/Invoices?ContactIDs=…`) → upsert `xero_invoices` + recompute
  `client_billing`. Scheduled on the same launchd setup as the M365 pull. Skips connections
  without a usable token; marks `reauth_required` on `invalid_grant`.
- **PDF on demand** — a server action `xeroInvoicePdf(invoiceId)` that re-checks the invoice
  belongs to the caller's client (defence in depth over RLS), fetches the live PDF from Xero
  (`GET /Invoices/{id}` with `Accept: application/pdf`), and streams it. Never stored.

## Client Billing page (`/billing`, managers)

- **Outstanding balance** headline + "as of [date]" (and an overdue figure if any).
- **Open invoices** — number, date, due date, amount, **overdue** flag, **Download PDF**.
- **Paid history** — past invoices, same row format.
- **Credit notes** — shown as their own type (reduce the balance).
- Empty/again-honest states: "no outstanding invoices", "billing isn't set up yet" (unmapped).

## Guardrails (client-facing financials)
1. **Only `AUTHORISED` / `PAID` invoices are ever shown.** Never `DRAFT` / `SUBMITTED` / `VOIDED` —
   a client must never see internal work-in-progress. Enforced in the pull (filter) and the view.
2. **Per-client opt-in** via `xero_contact_id` — you control exactly who sees Billing.
3. **Currency shown explicitly** (ZAR today, but per-invoice currency stored/displayed).

## Security & RLS
- `xero_connection` and the mapping: staff-only. Refresh token encrypted; never returned to the client.
- `xero_invoices` / `client_billing` RLS: `is_rocking_staff() OR client_id = current_client_id()`.
- The PDF action re-verifies `invoice.client_id = current_client_id()` before fetching.
- Service-role + `XERO_TOKEN_ENC_KEY` only in the pull/CLI, never the client bundle.
- `nav.ts`: "Billing" added to the `client_manager` group, shown only when the client is mapped.

## Slices
1. **Connection + mapping + pull + page.** OAuth connect script, `xero_contact_id`, the tables +
   RLS, `xero-pull.mjs`, and the `/billing` page (balance, open, paid, credit notes). Nightly
   schedule. This is the core client-facing value.
2. **Invoice PDF download** — the on-demand `xeroInvoicePdf` action + the row button.

## Out of scope (deliberate)
- **Pay-now / online payments** — no money movement; read-only display only.
- **Editing/creating invoices** — the Portal never writes to Xero.
- **True statement PDFs** — the page is the rendered statement.
- **Admin-only billing dashboard** — staff already see client billing via RLS; a dedicated admin
  roll-up can come later.

## Error handling
- Token expired/revoked → mark `reauth_required`, keep the last snapshot, surface a staff alert;
  the client page shows the last "as of" data, never an error.
- Unmapped client → no Billing tab.
- A Xero API failure mid-pull for one client doesn't abort the run (best-effort per client).

## Testing
- **RLS:** a client reads only their own `xero_invoices`; anon reads nothing.
- **Status filter:** `DRAFT`/`SUBMITTED`/`VOIDED` never appear in the pull output or page.
- **Mapping:** unmapped client has no Billing tab; mapped client shows their data.
- **PDF scope:** the PDF action refuses an invoice id that isn't the caller's.
- **Compute:** `client_billing.outstanding` = sum of `amount_due` over open invoices.
- Build compiles; pull a real mapped client (e.g. GSR Law) and eyeball balance vs Xero.
