# Products (client services catalog) — design

## Purpose

Give managers a way to see the products/services their company currently has
from Rocking (e.g. "Microsoft 365 Business Premium x10", "Backup — Veeam
1TB") — an inventory view, not a billing view. The initial list is sourced
from a Xero AR detail report and loaded by hand, one product at a time, after
this feature ships. There is no ongoing sync with Xero — updates are manual,
same as the existing Suppliers catalog.

## Data model

Two new tables (migration `0045_products.sql`):

- **`products`** — the shared catalog: `id`, `name`, `description`
  (nullable), `is_active` (boolean, default `true`), `created_at`.
  `is_active` lets staff retire a product from the "add" picker without
  breaking history for clients who already have it allocated.
- **`client_products`** — the per-client allocation: `id`, `client_id`
  (→ `clients`), `product_id` (→ `products`), `quantity` (int, default `1`),
  `note` (nullable text), `created_at`.

RLS: `products` is readable by any authenticated user (it's just catalog
metadata, same posture as `support_packages`) and writable only by staff.
`client_products` is staff-read/write-all; a client's own users may `select`
rows where `client_id = current_client_id()` — same pattern as
`support_time_entries`.

Removing an allocation is a hard delete (no history/audit trail needed —
updates are manual and infrequent).

## Admin UI

- **`/admin/products`** — catalog CRUD, same shape as the existing Suppliers
  page: searchable table (name, description, active/archived), "Add product"
  dialog, edit, and an archive/restore toggle instead of delete.
- **Products section on `/admin/clients/[id]`** — next to the existing
  Devices/Support/Users sections, same `Card`/`CardHeader` pattern as
  `SupportSection.tsx`: a table of this client's allocated products (name,
  qty, note) with an inline "Add product" form (select from active catalog +
  qty + note) and a per-row remove.

## Client-facing UI

- **`/services`** — new route, **managers only**. Guard mirrors `/billing`
  and `/team`: redirect unauthenticated users to `/login`, redirect
  `client_member` to `/`.
- Added to `lib/nav.ts` under the `client_manager` "Account" group only —
  `client_member`'s nav array is untouched, so members never see the link
  even if they guess the URL (and are redirected if they hit it directly).
- Flat list (no categories) sorted by product name: name, description as a
  subtitle, quantity, note. **No pricing shown anywhere on this page** —
  amounts already live on `/billing` via real Xero invoices, and showing a
  second, manually-maintained price here would drift out of sync with it.

## Out of scope (for this build)

- Any import/reconciliation script from the Xero AR report — Shawn is adding
  products one at a time by hand after this ships.
- Categorization/grouping of products — flat list only; can be added later
  once the real catalog size is visible.
- A cross-client "which clients have product X" view — cheap to add later
  once data exists, not needed for the first version.

## Testing

No non-trivial logic here worth unit tests — this is CRUD over two tables.
Verification is manual in the browser: staff can create a product and
allocate it to a client; a manager sees their own Services page; a member
has no nav link and is redirected on direct URL access; RLS blocks a client
from reading another client's `client_products` rows.
