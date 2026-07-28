# Compliance documents & company details

**Date:** 2026-07-28
**Status:** Approved for planning

## Problem

Two recurring manual jobs:

1. Clients repeatedly ask for Rocking's compliance documents (bank confirmation letter, tax clearance, BEE certificate). Staff email the same PDFs over and over.
2. Company details (registered name, VAT number, addresses, billing contact) live only in Xero. Clients can't see what Rocking holds on file, and corrections arrive by email and get missed.

Both surface under Billing, which already exists and is manager-gated.

## Scope

- Staff upload compliance PDFs once; every client manager can view and download them.
- Managers see the company details Rocking holds, and can edit them.
- Every edit is audited (who changed what, old → new) and emailed to `accounts@rocking.one`.
- Existing company details are backfilled from Xero.

Out of scope: routing invoices to `billing_contact_email` (stored as a record only — Xero still sends invoices), staff approval workflows, per-client documents, document versioning.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Company detail storage | Separate `client_company_details` table, 1:1 with `clients` | `clients` is a 4-column table read on nearly every page (nav, layout, lists). Adding 15 billing fields widens every one of those queries. |
| Edit flow | Applies immediately, then notifies | Simplest; the email to `accounts@rocking.one` is the safety net. No approvals queue to build or babysit. |
| Document visibility | Global — one library, all managers | These are Rocking's own documents. Per-client would mean re-uploading the same bank letter 140 times. |
| Audit log visibility | Managers see their own; staff see all | Transparent to the client, full picture for staff via the existing `/admin/activity` feed. |
| Placement | Tabs under `/billing` | Inherits the existing `billing` feature gate; adds no sidebar entries. |
| Audit row inserts | Service role, inside the server action | A manager must not be able to forge or delete their own audit entries. This is the integrity boundary. |

## Schema (migration `0061_company_details_and_compliance.sql`)

### `client_company_details`

One row per client, all fields nullable (clients may start blank).

| Column | Type | Notes |
|---|---|---|
| `client_id` | uuid PK → `clients(id)` on delete cascade | 1:1 |
| `registered_name`, `trading_name` | text | Identity |
| `registration_number`, `vat_number` | text | Identity |
| `physical_address`, `physical_city`, `physical_postal_code` | text | Street address |
| `postal_address`, `postal_city`, `postal_postal_code` | text | Postal address |
| `billing_contact_name`, `billing_contact_email`, `billing_contact_phone` | text | Who Rocking bills |
| `po_required` | boolean not null default false | Purchase order required on invoices |
| `billing_notes` | text | Free text reference |
| `updated_at` | timestamptz not null default now() | |
| `updated_by_profile_id` | uuid → `profiles(id)` on delete set null | |

### `company_detail_changes`

One row **per changed field** — this is what the activity log renders.

| Column | Type |
|---|---|
| `id` | uuid PK default gen_random_uuid() |
| `client_id` | uuid not null → `clients(id)` on delete cascade |
| `field` | text not null (column name, e.g. `vat_number`) |
| `old_value`, `new_value` | text (null = was/is empty) |
| `changed_by_profile_id` | uuid → `profiles(id)` on delete set null |
| `created_at` | timestamptz not null default now() |

Index on `(client_id, created_at desc)`.

### `compliance_documents`

| Column | Type |
|---|---|
| `id` | uuid PK default gen_random_uuid() |
| `description` | text **not null** — e.g. "Bank confirmation letter" |
| `storage_path` | text not null |
| `file_size` | integer |
| `mime_type` | text |
| `uploaded_by_profile_id` | uuid → `profiles(id)` on delete set null |
| `created_at` | timestamptz not null default now() |

### Storage

Private bucket `compliance-docs` (`public = false`), same shape as the existing `device-photos` bucket. Access is via short-lived signed URLs generated server-side; the bucket is never publicly readable.

## RLS

Mirrors the `device_photos` precedent.

**`client_company_details`**
- Staff: `for all using (is_rocking_staff()) with check (is_rocking_staff())`
- Managers: select / insert / update `using (client_id = current_client_id() and current_user_role() = 'client_manager')`, same predicate in `with check`
- Members: no policy — no access. (Billing is already manager-only.)

**`company_detail_changes`**
- Staff: `for all`
- Clients: **select only**, `using (client_id = current_client_id())`
- No client insert/update/delete policy. Rows are written by the server action with the service role, so the log cannot be forged or erased by the party it audits.

**`compliance_documents`**
- Staff: `for all` (upload, edit description, delete)
- Everyone authenticated: `for select using (true)` — the documents are Rocking's own and intended to be shared with all clients.

## File constraints (PDF only)

Enforcement lives in a new pure module `lib/compliance-helpers.ts`, mirroring `lib/device-photo-helpers.ts`:

```
MAX_DOC_BYTES = 4_000_000
documentError(file) -> string | null
safeDocName(name)   -> string
```

`documentError` rejects a file unless **all** of:
- `file.type === "application/pdf"`
- filename ends `.pdf` (case-insensitive)
- `0 < file.size <= MAX_DOC_BYTES`

**Why 4 MB, not 10 MB:** Vercel rejects serverless request bodies over 4.5 MB with a 413 *before* the server action runs. Device photos dodge this by downscaling client-side; a PDF can't be downscaled. So the cap must sit below the platform limit, and the error message must say so plainly ("PDFs must be under 4 MB — compress it or split it") rather than letting the user hit an opaque 413.

The `accept=".pdf,application/pdf"` attribute on the file input is UX only. The server check is the real gate — a client-side `accept` is trivially bypassed.

## Server actions

### `app/(admin)/admin/compliance/actions.ts` — staff only

- `uploadComplianceDocument(prev, formData)` — validates description (required, trimmed) and file via `documentError`; uploads to `compliance-docs/{uuid}-{safeDocName}`; inserts the row. **If the DB insert fails, the uploaded object is removed** so no orphan files accumulate (same as `uploadDevicePhotos`).
- `deleteComplianceDocument(id)` — removes the storage object then the row.

Both guard with the existing `rocking_staff` check and `revalidatePath`.

### `app/(app)/billing/company/actions.ts` — manager only

`saveCompanyDetails(prev, formData)`:

1. Guard: authenticated, `role === "client_manager"`, has `client_id`. Ignore any client-supplied client id — always use the session's.
2. Read current row (under RLS).
3. Normalise the submitted fields (trim; empty string → null).
4. `diffCompanyDetails(current, next)` → changed fields only.
5. If nothing changed, return `{ ok: true, changed: 0 }` — no write, no log row, no email.
6. Upsert the row with `updated_at` / `updated_by_profile_id`.
7. Insert one `company_detail_changes` row per changed field **via the service role**.
8. Send the notification email (see below).
9. `revalidatePath("/billing/company")`.

## Diff helper

`lib/company-details-helpers.ts` (pure, vitest-safe):

```
FIELD_LABELS: Record<string, string>          // vat_number -> "VAT number"
diffCompanyDetails(before, after) -> Change[] // { field, label, oldValue, newValue }
```

Rules: skip unchanged values; treat `null`, `undefined` and `""` as equivalent (so blank → blank is not a change); compare trimmed strings; `po_required` compared as boolean and rendered "Yes"/"No".

This is the heart of the feature — it drives the audit rows *and* the email body, so it is unit-tested directly.

## Email

`sendCompanyDetailsChanged()` in `lib/notify.ts`, calling the existing `sendEmail` chokepoint in `lib/email/send.ts` (never Resend directly — a bypassing send is invisible to `/communications` and the admin activity feed).

- **to:** `accounts@rocking.one`
- **subject:** `Company details updated — {Client name}`
- **body:** who changed it (name + email), when, and a table of field / old → new
- **category:** `admin_alert`, **audience:** `internal` (addressed to Rocking about a client — must not appear in the client's own communications history)
- **clientId:** the client, so it files correctly

**Failure rule:** the email is best-effort. If it throws, the save has already succeeded and the audit rows have already landed — catch, log, and still return success. Losing a legitimate edit because a notification failed would be the worse outcome. The database is the record of truth; the email is a convenience.

## UI

### `/billing` (tabs)

A shared `BillingTabs` component renders: **Invoices | Company details | Documents**, as three real routes rather than client-side state, so each has a URL and stays a server component.

### `/billing/company`

- Read-only definition grid of the details, grouped: Identity, Physical address, Postal address, Billing contact, Preferences. Empty fields render as `—`.
- **Edit details** button reveals the form (client component, `useActionState` + `useFormStatus`, matching the existing team/quote form patterns).
- Below: **Activity** — the `company_detail_changes` feed, newest first, rendered as "Chris Beart changed VAT number from 4160302941 to 4160302942 — 28 Jul 2026". First-time values render as "set VAT number to X". Empty state: "No changes recorded yet."

### `/billing/documents`

Table: description, uploaded date, Download button (signed URL, 1 hour TTL, generated at render). If a URL fails to sign, the row renders with the button disabled rather than a broken link. Empty state: "No documents available yet."

### `/admin/compliance`

Staff page: upload form (description + PDF picker) and the document list with delete. Added to the admin sidebar under **Services** as "Compliance docs".

## Backfill from Xero

`scripts/backfill-company-details.mjs` — a Node ESM script in the established `.mjs` style, run manually.

**Measured coverage across the 140 mapped contacts** (sampled 2026-07-28):

| Source field | Coverage |
|---|---|
| `EmailAddress` | 140/140 (100%) |
| POBOX address | 136/140 (97%) |
| STREET address | 129/140 (92%) |
| `FirstName`/`LastName` | 127/140 (91%) |
| `TaxNumber` | 88/140 (63%) |
| Phone | 56/140 (40%) |
| `CompanyNumber` | **13/140 (9%)** |

**Mapping**

| Target | Source |
|---|---|
| `registered_name` | `Contact.Name` |
| `vat_number` | `Contact.TaxNumber` |
| `registration_number` | `Contact.CompanyNumber` (rarely present — usually left blank for managers to fill) |
| `physical_*` | STREET address, falling back to POBOX when STREET is empty |
| `postal_*` | POBOX address **only when it differs from STREET** |
| `billing_contact_name` | `FirstName` + `LastName` |
| `billing_contact_email` | `EmailAddress` |
| `billing_contact_phone` | first `Phones[]` entry with a number, formatted `country area number` |

**Why postal is conditional:** STREET and POBOX are byte-identical for 117 of 140 contacts (84%). Copying both would show the same address twice on 84% of clients' pages, which reads as a bug.

**Rules**

- **Fill-only:** writes a field only when the target is currently null/blank. Never overwrites a value a manager has entered. This makes the script safely re-runnable.
- **Silent:** writes **no** `company_detail_changes` rows and sends **no** email. A seed is not a human edit; otherwise the first run would fire 140 emails at `accounts@rocking.one` and fill every log with "system changed everything". The audit log begins empty and records only real edits.
- `--dry` flag prints what would be written, changing nothing. Run this first.
- Reports skips explicitly: 2 of the 142 mapped clients did not come back from Xero's contact list (likely archived there). They are listed by name, never silently dropped.

## Testing

Vitest on the pure helpers (server-importing modules can't be unit-tested here — the established constraint in this repo):

**`lib/compliance-helpers.test.ts`**
- rejects a non-PDF mime type; rejects `.pdf` extension with wrong mime; rejects a PDF over 4 MB; rejects a 0-byte file; accepts a valid PDF
- `safeDocName` strips path separators and unsafe characters

**`lib/company-details-helpers.test.ts`**
- detects a changed field; ignores an unchanged one
- treats `null` → `""` as no change (the important one — stops phantom audit rows)
- trims before comparing
- `po_required` false → true renders "No" → "Yes"
- returns `[]` when nothing changed

## Risks

| Risk | Mitigation |
|---|---|
| Manager fixes a VAT number in the portal, but Xero still has the old one — invoices stay wrong | The email to `accounts@rocking.one` is the trigger for a human to update Xero. Stated plainly: the portal is the client's record, Xero remains the billing system. Not auto-synced back — writing to Xero from a client-editable form is a much bigger risk than a notification. |
| A manager sees another client's documents | Documents are deliberately global and contain only Rocking's own compliance paperwork. Nothing client-specific goes in this bucket — enforced by convention and the admin page copy. |
| Large PDF fails with an opaque platform 413 | 4 MB cap enforced server-side with an explicit message before the platform limit is hit. |
| Audit log tampering | Log rows are written with the service role and have no client insert/update/delete policy. |
| Backfill overwrites a manager's correction | Fill-only semantics; re-running is a no-op for any field already set. |
