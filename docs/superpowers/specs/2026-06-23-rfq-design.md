# RFQ — Request-for-Quote Tracker

**Date:** 2026-06-23
**Status:** Draft design, pending user review
**Project:** Rocking One Client Portal (dashboard-v2)

## Scope

An **admin-only** tracker for incoming quote requests — the front of the pipeline.
Requests land here (logged by staff), get **sourced** (waiting on supplier costing),
turn into client **Quotes**, and close **Won/Lost**. It ties the pieces already built
into one chain: **RFQ → Quote → Job**.

**In scope**
- An RFQ **Kanban board**: `New → Sourcing → Quoted → Won` (+ `Lost` off-board), stage
  changed via a status control (no drag in v1).
- An RFQ = title, **optional client** (existing portal client *or* free-text prospect),
  **requested by** (free text — a customer contact or a team member), description,
  optional `needed_by` date, a `sourcing_note` (the supplier you're waiting on, shown as
  the card tag while Sourcing), internal notes, an activity log, and an optional **linked
  quote**.
- **Link quote** action: attach the client quote that fulfils the RFQ → moves it to Quoted
  and stamps the quote number on the card.
- Admin-logged intake only.

**Out of scope (deliberate)**
- **Self-service intake** (a client/team "Request a quote" form) — fast-follow.
- **Auto-generate a quote from an RFQ** — quotes need priced line items and are created via
  the existing `create-quote` flow, so v1 *links* an existing quote rather than building one.
  An in-app quote builder would unlock create-from-RFQ later.
- Email notifications.

## Placement
New **"RFQs"** item in the admin sidebar **Business** group, **first** (pipeline order:
RFQs → Quotes → Jobs → Suppliers) → `/admin/rfqs`.

## Data model

- **`rfqs`** — `id, title (not null), client_id → clients (nullable, on delete set null),
  client_name text (free-text client/prospect when no client_id), requested_by text,
  description text, status text check in (new|sourcing|quoted|won|lost) default 'new',
  needed_by date, sourcing_note text, notes text, quote_id → quotes (nullable, on delete set null),
  lost_reason text, owner_profile_id → profiles (nullable), created_at, updated_at, closed_at`.
- **`rfq_events`** — activity log: `id, rfq_id → rfqs (on delete cascade), kind text
  (created|status|note|quote_linked), body text, posted_by_profile_id → profiles (nullable), created_at`.
- **RLS:** both `rocking_staff` only (`for all using (is_rocking_staff()) with check (is_rocking_staff())`).

**Display client name** = the linked client's name when `client_id` is set, else `client_name`
(prospect). This is what lets one tracker hold customer requests, team requests, and prospects.

## Board (`/admin/rfqs`)

Columns `new`, `sourcing`, `quoted`, `won`; `lost` hidden behind a toggle. Cards show title,
client (linked name or prospect), "from {requested_by}", and a tag: the `sourcing_note` while
Sourcing (amber), the linked quote number once Quoted/Won (info/green). **"+ New RFQ"** opens
the create form. Newest-updated first within a column.

**Moving a stage:** open the card → status control. Moving to `lost` reveals an optional
reason; `won`/`lost` stamp `closed_at`. Moving to `quoted` is encouraged via "Link quote" but
not blocked.

## RFQ detail (`/admin/rfqs/[id]`)

- Header: title, client (link if a real client), "from {requested_by}", status control.
- **Request:** description, `needed_by`, `sourcing_note` (editable; the Sourcing tag).
- **Linked quote:** the quote number → `/admin/quotes/[id]`, or a **"Link quote"** picker
  (lists the RFQ client's quotes; disabled with a prompt when the RFQ has only a prospect name
  and no real client yet).
- Internal **notes** + **activity log** (created / status changes / quote linked / notes).

## Creating an RFQ

**"+ New RFQ":** title, client (pick an existing client **or** type a prospect name),
requested_by, description, optional `needed_by`, optional `sourcing_note`. On create: insert
the RFQ (`new`) + a `created` event.

## Pipeline integration (the payoff)

- **Sourcing:** `sourcing_note` records who you're waiting on; staff jump to **Suppliers** for
  pricing (no hard link in v1 — a note).
- **Link quote:** sets `quote_id`, moves status → `quoted`, logs a `quote_linked` event. The
  existing quote then runs its own accept → **Create job from quote** path — so RFQ → Quote →
  Job is one click at each hop.
- **Won/Lost:** set manually on the RFQ (informational; not auto-derived from the quote in v1).

## Error handling
- `title` required; client optional (real client or free-text prospect, not both required).
- Deleting an RFQ cascades its events. Deleting the linked client/quote nulls the reference
  (RFQ survives).
- "Link quote" only lists quotes for the RFQ's `client_id`; unavailable for prospect-only RFQs.

## Testing
- **RLS:** only `rocking_staff` can read/write `rfqs` / `rfq_events`.
- **Logic:** status transitions stamp/clear `closed_at`; card tag resolves (sourcing_note vs
  quote number); link-quote sets status + logs.
- **Display:** prospect (client_name) and real-client (client_id) RFQs both render the right name.
- Build compiles; create an RFQ, move stages, link a quote, mark won.

## Build order
1. Migration: `rfqs`, `rfq_events` + RLS + status check.
2. Data layer `lib/views/rfqs.ts` (board, detail, create, set-status, link-quote, post-note) + actions.
3. Board page `/admin/rfqs` (Kanban + status control + new-RFQ dialog).
4. Detail page `/admin/rfqs/[id]` (request, status, link-quote, notes, activity).
5. Sidebar nav entry (Business, first).
6. Verify end-to-end (create → source → link a quote → won).
