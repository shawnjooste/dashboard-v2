# Suppliers — Document Library (Slice 1)

**Date:** 2026-06-22
**Status:** Draft design, pending user review
**Project:** Rocking One Client Portal (dashboard-v2)

## Scope

An **admin-only** suppliers section: a directory of suppliers, each with **uploaded
documents** (their quotes, price lists, spec sheets) you can reference later —
especially while quoting clients. Introduces **Supabase Storage** (the Portal's first
file uploads).

**In scope**
- `suppliers` directory (company + contact details).
- `supplier_documents` — an uploaded file per record, with commercial metadata
  (type, reference, amount + currency, doc date, **valid-until**, notes).
- Browse + search; supplier detail with upload/download.
- Private Storage bucket; all file access server-side and staff-guarded.

**Out of scope (deliberate)**
- The formal **quote ↔ document link** (fast-follow).
- A structured price catalogue; OCR / auto-extraction from files.

**Future — Slice 2 (separate spec): email auto-capture.** A CC address
(`supplier@send.rocking.one`) that auto-files supplier emails + attachments into this
library. Needs an inbound-email mechanism (verify Resend inbound vs Cloudflare/SendGrid
inbound-parse), DNS/MX setup, a Portal webhook, sender→supplier matching, and an
unmatched queue. Built on top of this library, which is why the library ships first.

## Data model

- **`suppliers`** — `id, name (not null), category, contact_name, email, phone, website,
  notes, created_at, updated_at`.
- **`supplier_documents`** — `id, supplier_id → suppliers (on delete cascade),
  title (not null), doc_type text check in (quote|price_list|spec|invoice|other) default 'quote',
  reference, amount numeric, currency text default 'ZAR', doc_date date, valid_until date,
  notes, storage_path text (the file in the bucket), file_name, file_size int, mime_type,
  uploaded_by_profile_id, created_at`.
- Derived: a document is **expired** when `valid_until < today` (badge in the UI; never stored).
- **RLS:** both tables `for all using (public.is_rocking_staff()) with check (public.is_rocking_staff())`.

## Storage

- A **private** bucket **`supplier-docs`** (internal pricing — never public). Created in the
  migration: `insert into storage.buckets (id, name, public) values ('supplier-docs','supplier-docs', false)`.
- **All access is server-side**, through admin server actions using the **service client**,
  guarded by an `is_rocking_staff` check — so a file never reaches the browser without passing
  that guard, and no storage RLS policy is needed.
  - **Upload:** a server action reads the file from `FormData` and uploads it to
    `supplier-docs/{supplier_id}/{uuid}-{filename}`, then inserts the `supplier_documents` row.
    Next's server-action body limit is raised to **15 MB** (`next.config` `serverActions.bodySizeLimit`)
    — supplier PDFs/spreadsheets fit comfortably. *(If files ever get larger, switch to a signed
    upload URL so the browser uploads directly to Storage.)*
  - **Download / open:** a server action generates a short-lived **signed URL**
    (`createSignedUrl`, ~60s) that the client opens in a new tab.
- Accepts PDF, Excel/CSV, common image types. Max ~15 MB.

## UI (admin → Business → Suppliers)

- **`/admin/suppliers`** — searchable list: name, category, contact, # documents, latest doc
  date. **"+ Add supplier"** (modal: name, category, contact name/email/phone, website, notes).
- **`/admin/suppliers/[id]`** — the supplier's details (editable inline form) + their documents.
  Each doc row: title, type, doc date, amount + currency, valid-until (with an **expired** badge),
  notes, and a **Download** link (signed URL). An **"Upload document"** form (file picker +
  the metadata fields). Delete a document (removes the row + the stored file).

## Server actions
`createSupplier`, `updateSupplier`, `uploadSupplierDocument` (FormData incl. file),
`deleteSupplierDocument` (row + storage object), `supplierDocumentUrl` (returns a signed URL).
All begin with a `rocking_staff` guard.

## Error handling
- Reject uploads with no file, or over the size limit (clear message).
- A failed Storage upload aborts before inserting the metadata row (no orphan rows); a failed
  metadata insert removes the just-uploaded object (no orphan files).
- Deleting a supplier cascades its document rows; their storage objects are removed in the action.

## Testing
- **RLS:** only `rocking_staff` can read/write `suppliers` / `supplier_documents`.
- **Storage:** upload → object lands in the private bucket; the bucket is **not** publicly
  readable; download works only via a signed URL.
- **Logic:** expired badge from `valid_until`; doc counts + latest-date on the list; cascade delete
  removes both rows and files.
- Build compiles; create a supplier, upload a file, download it, delete it.

## Build order
1. Migration: `suppliers`, `supplier_documents` + RLS + the private `supplier-docs` bucket.
2. `next.config` server-action body limit → 15 MB.
3. Data layer `lib/views/suppliers.ts` (list + counts, detail + documents).
4. Server actions (`lib/` storage helper + `app/(admin)/admin/suppliers/actions.ts`).
5. Suppliers list page + Add-supplier dialog.
6. Supplier detail page + upload form + document list (download/delete).
7. Sidebar nav entry under Business.
8. Verify end-to-end (upload a real supplier PDF, download via signed URL, expired badge).
