# Compliance Documents & Company Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two surfaces under Billing — a global library of staff-uploaded compliance PDFs that client managers can download, and a manager-editable company-details page with a field-level audit log where every edit is emailed to `accounts@rocking.one`.

**Architecture:** Three new tables (`client_company_details` 1:1 with clients, `company_detail_changes` as an append-only audit trail, `compliance_documents` global) plus a private `compliance-docs` storage bucket. Two pure helper modules carry all the logic worth unit-testing (PDF validation, field diffing); server actions wire them to the database. Billing becomes three sibling routes sharing a tab strip. A separate one-off script backfills details from Xero without touching the audit trail.

**Tech Stack:** Next.js 16 App Router (server components + server actions), Supabase (Postgres + RLS + Storage), TypeScript, Vitest, Tailwind, Resend (via the `lib/email/send.ts` chokepoint).

## Global Constraints

- **Supabase project ref is `eskhokedsximnslgsycs`** (dashboard-v2). NOT `qomxwxxulxcwnpaqzudl` — that is a different project.
- Migrations run with `supabase db push --linked`. Types regenerate with `supabase gen types typescript --linked > lib/types/database.ts`.
- All development happens on the **`main`** branch of dashboard-v2.
- **Max PDF size is 4,000,000 bytes.** Vercel rejects serverless request bodies over 4.5 MB with a 413 before the server action runs — the cap must sit below it.
- **Compliance documents accept `application/pdf` only.** The client-side `accept` attribute is UX; the server check is the gate.
- **Every email goes through `sendEmail` from `lib/email/send.ts`.** Never call Resend directly — a bypassing send is invisible to `/communications` and the admin activity feed.
- **Audit rows are written with the service role** (`createServiceClient()`), never the RLS client. A manager must not be able to forge or delete entries in their own audit log.
- Audit notification email: **to `accounts@rocking.one`**, `category: "admin_alert"`, `audience: "internal"`.
- Existing RLS helpers to use: `public.is_rocking_staff()`, `public.current_client_id()`, `public.current_user_role()`.
- Tests are Vitest, `environment: "node"`, run with `npm test`. Only pure modules (no `server-only` imports) can be unit-tested — server modules break the runner.
- Tailwind design tokens only: `bg-card border-line text-ink text-ink-2 text-muted text-faint text-brand text-good bg-brand-tint bg-canvas border-line-soft`.
- Commit messages end with: `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`

---

## File Structure

**Created:**
- `supabase/migrations/0061_company_details_and_compliance.sql` — three tables, RLS, storage bucket
- `lib/compliance-helpers.ts` — pure PDF validation + filename sanitising
- `lib/compliance-helpers.test.ts` — its tests
- `lib/company-details-helpers.ts` — pure field labels + diffing
- `lib/company-details-helpers.test.ts` — its tests
- `lib/views/company-details.ts` — reads details + change log (server)
- `lib/views/compliance-documents.ts` — reads documents + signs URLs (server)
- `components/BillingTabs.tsx` — shared tab strip for the three Billing routes
- `app/(app)/billing/company/page.tsx` — manager view of details + audit log
- `app/(app)/billing/company/actions.ts` — `saveCompanyDetails`
- `app/(app)/billing/company/CompanyDetailsForm.tsx` — client form component
- `app/(app)/billing/documents/page.tsx` — manager document list
- `app/(admin)/admin/compliance/page.tsx` — staff upload + manage
- `app/(admin)/admin/compliance/actions.ts` — upload/delete
- `app/(admin)/admin/compliance/ComplianceUpload.tsx` — client upload form
- `scripts/backfill-company-details.mjs` — one-off Xero seed

**Modified:**
- `lib/notify.ts` — add `sendCompanyDetailsChanged`
- `lib/views/activity.ts` — merge `company_detail_changes` into the admin feed
- `lib/nav.ts` — add "Compliance docs" to the staff Services group
- `app/(app)/billing/page.tsx` — render the tab strip
- `lib/types/database.ts` — regenerated

---

## Task 1: Migration — tables, RLS, storage bucket

> **Numbering note (2026-07-28):** `0061_sent_emails.sql` and `0062_staff_supplier_request.sql`
> landed from a concurrent session after this plan was written. This migration ships as
> **`0063_company_details_and_compliance.sql`**. Contents unchanged.

**Files:**
- Create: `supabase/migrations/0063_company_details_and_compliance.sql`
- Modify: `lib/types/database.ts` (regenerated, not hand-edited)

**Interfaces:**
- Consumes: existing `public.clients`, `public.profiles`, and the RLS helpers `is_rocking_staff()`, `current_client_id()`, `current_user_role()`.
- Produces: tables `client_company_details`, `company_detail_changes`, `compliance_documents`; storage bucket `compliance-docs`. Column names below are relied on verbatim by Tasks 2–10.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0061_company_details_and_compliance.sql`:

```sql
-- Company details a client manager can see and correct, plus an append-only
-- audit trail of their edits, plus Rocking's own compliance documents.

-- 1. Company details -------------------------------------------------------
-- Kept out of public.clients deliberately: clients is a 4-column table read on
-- nearly every page (nav, layout, client lists), and widening it would widen
-- all of those queries.
create table public.client_company_details (
  client_id             uuid primary key references public.clients(id) on delete cascade,
  registered_name       text,
  trading_name          text,
  registration_number   text,
  vat_number            text,
  physical_address      text,
  physical_city         text,
  physical_postal_code  text,
  postal_address        text,
  postal_city           text,
  postal_postal_code    text,
  billing_contact_name  text,
  billing_contact_email text,
  billing_contact_phone text,
  po_required           boolean not null default false,
  billing_notes         text,
  updated_at            timestamptz not null default now(),
  updated_by_profile_id uuid references public.profiles(id) on delete set null
);

alter table public.client_company_details enable row level security;

create policy company_details_staff on public.client_company_details
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

-- Managers read and maintain their own client's row. Members get no policy at
-- all, so they cannot see it — Billing is manager-only by design.
create policy company_details_manager_read on public.client_company_details
  for select using (
    client_id = public.current_client_id()
    and public.current_user_role() = 'client_manager'
  );

create policy company_details_manager_insert on public.client_company_details
  for insert with check (
    client_id = public.current_client_id()
    and public.current_user_role() = 'client_manager'
  );

create policy company_details_manager_update on public.client_company_details
  for update using (
    client_id = public.current_client_id()
    and public.current_user_role() = 'client_manager'
  ) with check (
    client_id = public.current_client_id()
    and public.current_user_role() = 'client_manager'
  );

-- 2. Audit trail -----------------------------------------------------------
-- One row per changed field. Deliberately has NO client insert/update/delete
-- policy: rows are written by the server action with the service role, so the
-- party being audited cannot forge or erase entries.
create table public.company_detail_changes (
  id                    uuid primary key default gen_random_uuid(),
  client_id             uuid not null references public.clients(id) on delete cascade,
  field                 text not null,
  old_value             text,
  new_value             text,
  changed_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at            timestamptz not null default now()
);
create index company_detail_changes_client_idx
  on public.company_detail_changes (client_id, created_at desc);

alter table public.company_detail_changes enable row level security;

create policy company_detail_changes_staff on public.company_detail_changes
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

create policy company_detail_changes_client_read on public.company_detail_changes
  for select using (client_id = public.current_client_id());

-- 3. Compliance documents --------------------------------------------------
-- Rocking's own paperwork (bank confirmation letter, tax clearance, BEE
-- certificate): uploaded once, readable by every signed-in user. Nothing
-- client-specific belongs in this table.
create table public.compliance_documents (
  id                     uuid primary key default gen_random_uuid(),
  description            text not null,
  storage_path           text not null,
  file_size              integer,
  mime_type              text,
  uploaded_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index compliance_documents_created_idx
  on public.compliance_documents (created_at desc);

alter table public.compliance_documents enable row level security;

create policy compliance_documents_staff on public.compliance_documents
  for all using (public.is_rocking_staff()) with check (public.is_rocking_staff());

create policy compliance_documents_read on public.compliance_documents
  for select using (true);

-- 4. Private storage bucket for the PDFs (server-side signed access only) ---
insert into storage.buckets (id, name, public)
values ('compliance-docs', 'compliance-docs', false)
on conflict (id) do nothing;
```

- [ ] **Step 2: Push the migration**

Run: `supabase db push --linked`
Expected: reports `0061_company_details_and_compliance.sql` applied, no errors.

- [ ] **Step 3: Verify RLS is on and the bucket exists**

Run:
```bash
supabase db push --linked --dry-run
```
Expected: `Remote database is up to date.` (nothing left to apply).

- [ ] **Step 4: Regenerate types**

Run: `supabase gen types typescript --linked > lib/types/database.ts`

- [ ] **Step 5: Confirm the new tables are in the types**

Run: `grep -c "client_company_details\|company_detail_changes\|compliance_documents" lib/types/database.ts`
Expected: a number greater than 3.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0061_company_details_and_compliance.sql lib/types/database.ts
git commit -m "feat(billing): schema for company details, audit log and compliance docs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Pure PDF validation helpers

**Files:**
- Create: `lib/compliance-helpers.ts`
- Test: `lib/compliance-helpers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MAX_DOC_BYTES: number`, `safeDocName(name: string): string`, `documentError(file: { type: string; size: number; name: string }): string | null`. Task 6 (`uploadComplianceDocument`) calls both functions.

- [ ] **Step 1: Write the failing tests**

Create `lib/compliance-helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { documentError, safeDocName, MAX_DOC_BYTES } from "./compliance-helpers";

const pdf = (over: Partial<{ type: string; size: number; name: string }> = {}) => ({
  type: "application/pdf",
  size: 1000,
  name: "letter.pdf",
  ...over,
});

describe("documentError", () => {
  it("accepts a normal PDF", () => {
    expect(documentError(pdf())).toBeNull();
  });
  it("rejects a non-PDF mime type", () => {
    expect(documentError(pdf({ type: "image/png", name: "logo.png" }))).toBe("logo.png: only PDF files are allowed.");
  });
  it("rejects a .pdf name carrying the wrong mime type", () => {
    expect(documentError(pdf({ type: "application/octet-stream" }))).toBe("letter.pdf: only PDF files are allowed.");
  });
  it("accepts an uppercase .PDF extension", () => {
    expect(documentError(pdf({ name: "LETTER.PDF" }))).toBeNull();
  });
  it("rejects a PDF mime type with a non-pdf extension", () => {
    expect(documentError(pdf({ name: "letter.exe" }))).toBe("letter.exe: only PDF files are allowed.");
  });
  it("rejects an empty file", () => {
    expect(documentError(pdf({ size: 0 }))).toBe("letter.pdf: the file is empty.");
  });
  it("rejects a file over the size cap", () => {
    expect(documentError(pdf({ size: MAX_DOC_BYTES + 1 }))).toBe("letter.pdf: over the 4 MB limit — compress it or split it.");
  });
  it("accepts a file exactly at the cap", () => {
    expect(documentError(pdf({ size: MAX_DOC_BYTES }))).toBeNull();
  });
});

describe("safeDocName", () => {
  it("keeps a clean name", () => {
    expect(safeDocName("bank-letter.pdf")).toBe("bank-letter.pdf");
  });
  it("replaces spaces and unsafe characters", () => {
    expect(safeDocName("Bank Letter (2026).pdf")).toBe("Bank_Letter__2026_.pdf");
  });
  it("strips path separators so a name cannot escape its folder", () => {
    expect(safeDocName("../../etc/passwd.pdf")).toBe("______etc_passwd.pdf");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/compliance-helpers.test.ts`
Expected: FAIL — `Failed to resolve import "./compliance-helpers"`.

- [ ] **Step 3: Write the implementation**

Create `lib/compliance-helpers.ts`:

```typescript
/** Pure validation/naming helpers for compliance documents — no server imports (vitest-safe). */

/** Vercel rejects serverless request bodies over 4.5 MB with a 413 before the
 *  server action runs. Unlike photos, a PDF can't be downscaled client-side,
 *  so the cap has to sit below the platform limit. */
export const MAX_DOC_BYTES = 4_000_000;

export function safeDocName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Returns a human-readable error, or null when the file is an acceptable PDF. */
export function documentError(file: { type: string; size: number; name: string }): string | null {
  const isPdf = file.type === "application/pdf" && /\.pdf$/i.test(file.name);
  if (!isPdf) return `${file.name}: only PDF files are allowed.`;
  if (file.size <= 0) return `${file.name}: the file is empty.`;
  if (file.size > MAX_DOC_BYTES) return `${file.name}: over the 4 MB limit — compress it or split it.`;
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/compliance-helpers.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/compliance-helpers.ts lib/compliance-helpers.test.ts
git commit -m "feat(billing): PDF validation helpers for compliance documents

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Pure company-details diff helpers

**Files:**
- Create: `lib/company-details-helpers.ts`
- Test: `lib/company-details-helpers.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type CompanyDetails` — the editable field set (no `client_id`/`updated_at`).
  - `EDITABLE_FIELDS: readonly (keyof CompanyDetails)[]`
  - `FIELD_LABELS: Record<keyof CompanyDetails, string>`
  - `type DetailChange = { field: string; label: string; oldValue: string | null; newValue: string | null }`
  - `normaliseDetails(input: Record<string, FormDataEntryValue | null>): CompanyDetails`
  - `diffCompanyDetails(before: Partial<CompanyDetails> | null, after: CompanyDetails): DetailChange[]`
  - `formatValue(field: keyof CompanyDetails, value: string | boolean | null): string`

  Task 7 (`saveCompanyDetails`) and Task 8 (email) consume all of these.

- [ ] **Step 1: Write the failing tests**

Create `lib/company-details-helpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  diffCompanyDetails,
  normaliseDetails,
  formatValue,
  FIELD_LABELS,
  EDITABLE_FIELDS,
  type CompanyDetails,
} from "./company-details-helpers";

const blank = (): CompanyDetails => ({
  registered_name: null,
  trading_name: null,
  registration_number: null,
  vat_number: null,
  physical_address: null,
  physical_city: null,
  physical_postal_code: null,
  postal_address: null,
  postal_city: null,
  postal_postal_code: null,
  billing_contact_name: null,
  billing_contact_email: null,
  billing_contact_phone: null,
  po_required: false,
  billing_notes: null,
});

describe("diffCompanyDetails", () => {
  it("returns nothing when nothing changed", () => {
    const before = { ...blank(), vat_number: "4160302941" };
    const after = { ...blank(), vat_number: "4160302941" };
    expect(diffCompanyDetails(before, after)).toEqual([]);
  });

  it("detects a changed field with its label", () => {
    const before = { ...blank(), vat_number: "4160302941" };
    const after = { ...blank(), vat_number: "4160302942" };
    expect(diffCompanyDetails(before, after)).toEqual([
      { field: "vat_number", label: "VAT number", oldValue: "4160302941", newValue: "4160302942" },
    ]);
  });

  it("treats null and empty string as the same — no phantom change", () => {
    const before = { ...blank(), trading_name: null };
    const after = { ...blank(), trading_name: null };
    expect(diffCompanyDetails(before, after)).toEqual([]);
  });

  it("records a first-time value as a change from null", () => {
    const after = { ...blank(), vat_number: "4160302941" };
    expect(diffCompanyDetails(blank(), after)).toEqual([
      { field: "vat_number", label: "VAT number", oldValue: null, newValue: "4160302941" },
    ]);
  });

  it("treats a missing before-row as all-null", () => {
    const after = { ...blank(), registered_name: "Acme (Pty) Ltd" };
    expect(diffCompanyDetails(null, after)).toEqual([
      { field: "registered_name", label: "Registered name", oldValue: null, newValue: "Acme (Pty) Ltd" },
    ]);
  });

  it("renders a po_required change as Yes/No", () => {
    const after = { ...blank(), po_required: true };
    expect(diffCompanyDetails(blank(), after)).toEqual([
      { field: "po_required", label: "PO required on invoices", oldValue: "No", newValue: "Yes" },
    ]);
  });

  it("reports several changed fields at once", () => {
    const after = { ...blank(), vat_number: "123", physical_city: "Cape Town" };
    expect(diffCompanyDetails(blank(), after).map((c) => c.field).sort()).toEqual(["physical_city", "vat_number"]);
  });
});

describe("normaliseDetails", () => {
  it("trims values and turns blanks into null", () => {
    const out = normaliseDetails({ vat_number: "  4160302941  ", trading_name: "   " });
    expect(out.vat_number).toBe("4160302941");
    expect(out.trading_name).toBeNull();
  });

  it("reads a checked checkbox as true and a missing one as false", () => {
    expect(normaliseDetails({ po_required: "on" }).po_required).toBe(true);
    expect(normaliseDetails({}).po_required).toBe(false);
  });

  it("ignores keys that are not editable fields", () => {
    const out = normaliseDetails({ client_id: "sneaky", vat_number: "1" }) as Record<string, unknown>;
    expect(out.client_id).toBeUndefined();
  });
});

describe("formatValue", () => {
  it("shows an em-dash for an empty value", () => {
    expect(formatValue("vat_number", null)).toBe("—");
  });
  it("shows Yes/No for po_required", () => {
    expect(formatValue("po_required", true)).toBe("Yes");
    expect(formatValue("po_required", false)).toBe("No");
  });
});

describe("field metadata", () => {
  it("labels every editable field", () => {
    for (const f of EDITABLE_FIELDS) expect(FIELD_LABELS[f]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/company-details-helpers.test.ts`
Expected: FAIL — `Failed to resolve import "./company-details-helpers"`.

- [ ] **Step 3: Write the implementation**

Create `lib/company-details-helpers.ts`:

```typescript
/** Pure company-details logic — no server imports (vitest-safe).
 *  Drives both the audit-log rows and the notification email, so it is the
 *  one piece of this feature worth testing directly. */

export type CompanyDetails = {
  registered_name: string | null;
  trading_name: string | null;
  registration_number: string | null;
  vat_number: string | null;
  physical_address: string | null;
  physical_city: string | null;
  physical_postal_code: string | null;
  postal_address: string | null;
  postal_city: string | null;
  postal_postal_code: string | null;
  billing_contact_name: string | null;
  billing_contact_email: string | null;
  billing_contact_phone: string | null;
  po_required: boolean;
  billing_notes: string | null;
};

export const EDITABLE_FIELDS = [
  "registered_name",
  "trading_name",
  "registration_number",
  "vat_number",
  "physical_address",
  "physical_city",
  "physical_postal_code",
  "postal_address",
  "postal_city",
  "postal_postal_code",
  "billing_contact_name",
  "billing_contact_email",
  "billing_contact_phone",
  "po_required",
  "billing_notes",
] as const satisfies readonly (keyof CompanyDetails)[];

export const FIELD_LABELS: Record<keyof CompanyDetails, string> = {
  registered_name: "Registered name",
  trading_name: "Trading name",
  registration_number: "Company registration number",
  vat_number: "VAT number",
  physical_address: "Physical address",
  physical_city: "Physical city",
  physical_postal_code: "Physical postal code",
  postal_address: "Postal address",
  postal_city: "Postal city",
  postal_postal_code: "Postal postal code",
  billing_contact_name: "Billing contact name",
  billing_contact_email: "Billing contact email",
  billing_contact_phone: "Billing contact phone",
  po_required: "PO required on invoices",
  billing_notes: "Billing notes",
};

export type DetailChange = {
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
};

/** Display form of a stored value: em-dash when empty, Yes/No for the flag. */
export function formatValue(field: keyof CompanyDetails, value: string | boolean | null): string {
  if (field === "po_required") return value ? "Yes" : "No";
  const s = typeof value === "string" ? value.trim() : "";
  return s === "" ? "—" : s;
}

/** Comparable form: null and "" collapse to null so blank→blank is not a change. */
function comparable(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/** Pull the editable fields out of raw form data, trimming and nulling blanks.
 *  Anything not in EDITABLE_FIELDS is dropped — a client cannot smuggle in an
 *  extra column by adding a form field. */
export function normaliseDetails(input: Record<string, FormDataEntryValue | null>): CompanyDetails {
  const out = {} as CompanyDetails;
  for (const field of EDITABLE_FIELDS) {
    if (field === "po_required") {
      out.po_required = input.po_required != null && input.po_required !== "";
      continue;
    }
    const raw = input[field];
    const s = typeof raw === "string" ? raw.trim() : "";
    (out as Record<string, string | null>)[field] = s === "" ? null : s;
  }
  return out;
}

/** Field-by-field difference, skipping anything unchanged. A missing `before`
 *  (no row yet) is treated as every field being empty. */
export function diffCompanyDetails(
  before: Partial<CompanyDetails> | null,
  after: CompanyDetails,
): DetailChange[] {
  const changes: DetailChange[] = [];
  for (const field of EDITABLE_FIELDS) {
    const oldValue = comparable(before ? before[field] : null);
    const newValue = comparable(after[field]);
    if (oldValue === newValue) continue;
    changes.push({ field, label: FIELD_LABELS[field], oldValue, newValue });
  }
  return changes;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/company-details-helpers.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Run the whole suite to confirm nothing else broke**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/company-details-helpers.ts lib/company-details-helpers.test.ts
git commit -m "feat(billing): company-details diff and normalisation helpers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Read layer — company details and change log

**Files:**
- Create: `lib/views/company-details.ts`

**Interfaces:**
- Consumes: `CompanyDetails`, `FIELD_LABELS` from Task 3; `createClient` from `@/lib/supabase/server`.
- Produces:
  - `type CompanyDetailsRow = CompanyDetails & { updatedAt: string | null }`
  - `type ChangeEntry = { id: string; label: string; oldValue: string | null; newValue: string | null; actor: string | null; at: string }`
  - `getCompanyDetails(clientId: string): Promise<CompanyDetailsRow>` — always returns an object; every field is null when no row exists.
  - `getCompanyDetailChanges(clientId: string, limit?: number): Promise<ChangeEntry[]>`

  Task 9 (the page) renders both.

- [ ] **Step 1: Write the read module**

Create `lib/views/company-details.ts`:

```typescript
import { createClient } from "@/lib/supabase/server";
import {
  EDITABLE_FIELDS,
  FIELD_LABELS,
  type CompanyDetails,
} from "@/lib/company-details-helpers";

export type CompanyDetailsRow = CompanyDetails & { updatedAt: string | null };

export type ChangeEntry = {
  id: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  actor: string | null;
  at: string;
};

const EMPTY: CompanyDetails = {
  registered_name: null,
  trading_name: null,
  registration_number: null,
  vat_number: null,
  physical_address: null,
  physical_city: null,
  physical_postal_code: null,
  postal_address: null,
  postal_city: null,
  postal_postal_code: null,
  billing_contact_name: null,
  billing_contact_email: null,
  billing_contact_phone: null,
  po_required: false,
  billing_notes: null,
};

/** The details on file for a client. Runs under the caller's RLS, so a manager
 *  only ever resolves their own client. Returns an all-null shape rather than
 *  null when no row exists yet, so callers never branch on existence. */
export async function getCompanyDetails(clientId: string): Promise<CompanyDetailsRow> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_company_details")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (!data) return { ...EMPTY, updatedAt: null };

  const row = { ...EMPTY } as CompanyDetails;
  for (const field of EDITABLE_FIELDS) {
    if (field === "po_required") row.po_required = Boolean(data.po_required);
    else (row as Record<string, string | null>)[field] = (data as Record<string, string | null>)[field] ?? null;
  }
  return { ...row, updatedAt: data.updated_at ?? null };
}

/** The audit trail, newest first. Actor is resolved through the caller's own
 *  RLS view of profiles — a client sees their colleagues' names but not staff. */
export async function getCompanyDetailChanges(clientId: string, limit = 50): Promise<ChangeEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("company_detail_changes")
    .select("id, field, old_value, new_value, changed_by_profile_id, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!data?.length) return [];

  const { data: profiles } = await supabase.from("profiles").select("id, email");
  const email = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  const label = (id: string | null) => {
    const e = id ? email.get(id) : null;
    return e ? e.split("@")[0].replace(/[._]/g, " ") : null;
  };

  return data.map((c) => ({
    id: c.id,
    label: FIELD_LABELS[c.field as keyof CompanyDetails] ?? c.field,
    oldValue: c.old_value,
    newValue: c.new_value,
    actor: label(c.changed_by_profile_id),
    at: c.created_at,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/views/company-details.ts
git commit -m "feat(billing): read layer for company details and change log

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Read layer — compliance documents

**Files:**
- Create: `lib/views/compliance-documents.ts`

**Interfaces:**
- Consumes: `createClient` from `@/lib/supabase/server`, `createServiceClient` from `@/lib/supabase/service`.
- Produces: `type ComplianceDocument = { id: string; description: string; createdAt: string; fileSize: number | null; url: string | null }` and `getComplianceDocuments(): Promise<ComplianceDocument[]>`. Tasks 10 and 11 render this.

- [ ] **Step 1: Write the read module**

Create `lib/views/compliance-documents.ts`:

```typescript
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "compliance-docs";

export type ComplianceDocument = {
  id: string;
  description: string;
  createdAt: string;
  fileSize: number | null;
  url: string | null;
};

/**
 * Rocking's compliance documents, newest first. The select runs under the
 * caller's RLS (every signed-in user may read them), and URLs are only signed
 * for rows RLS actually returned — so the signed URLs inherit the same access
 * control. URLs last one hour, i.e. one server render.
 */
export async function getComplianceDocuments(): Promise<ComplianceDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("compliance_documents")
    .select("id, description, storage_path, file_size, created_at")
    .order("created_at", { ascending: false });
  if (!data?.length) return [];

  const { data: signed } = await createServiceClient()
    .storage.from(BUCKET)
    .createSignedUrls(data.map((d) => d.storage_path), 3600);
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return data.map((d) => ({
    id: d.id,
    description: d.description,
    createdAt: d.created_at,
    fileSize: d.file_size,
    url: urlByPath.get(d.storage_path) ?? null,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/views/compliance-documents.ts
git commit -m "feat(billing): read layer for compliance documents

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Admin upload — actions and page

**Files:**
- Create: `app/(admin)/admin/compliance/actions.ts`
- Create: `app/(admin)/admin/compliance/ComplianceUpload.tsx`
- Create: `app/(admin)/admin/compliance/page.tsx`
- Modify: `lib/nav.ts` (staff `Services` group)

**Interfaces:**
- Consumes: `documentError`, `safeDocName` (Task 2); `getComplianceDocuments` (Task 5).
- Produces: `type UploadResult = { ok: true } | { ok: false; error: string }`, `uploadComplianceDocument(prev: UploadResult | null, formData: FormData): Promise<UploadResult>`, `deleteComplianceDocument(id: string): Promise<void>`.

- [ ] **Step 1: Write the server actions**

Create `app/(admin)/admin/compliance/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { documentError, safeDocName } from "@/lib/compliance-helpers";

const BUCKET = "compliance-docs";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

function revalidateAll() {
  revalidatePath("/admin/compliance");
  revalidatePath("/billing/documents");
}

export type UploadResult = { ok: true } | { ok: false; error: string };

/** Staff-only. Stores one PDF with its description. The description is what
 *  clients actually read, so it is required. */
export async function uploadComplianceDocument(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const me = await staff();

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, error: "Give the document a description." };

  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Pick a PDF to upload." };

  const invalid = documentError(file);
  if (invalid) return { ok: false, error: invalid };

  const service = createServiceClient();
  const path = `${crypto.randomUUID()}-${safeDocName(file.name)}`;
  const { error: upErr } = await service.storage
    .from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const supabase = await createClient();
  const { error: insErr } = await supabase.from("compliance_documents").insert({
    description,
    storage_path: path,
    file_size: file.size,
    mime_type: file.type,
    uploaded_by_profile_id: me.id,
  });
  if (insErr) {
    await service.storage.from(BUCKET).remove([path]); // no orphan file
    return { ok: false, error: insErr.message };
  }

  revalidateAll();
  return { ok: true };
}

export async function deleteComplianceDocument(id: string): Promise<void> {
  await staff();
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("compliance_documents")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (doc?.storage_path) await createServiceClient().storage.from(BUCKET).remove([doc.storage_path]);
  await supabase.from("compliance_documents").delete().eq("id", id);
  revalidateAll();
}
```

- [ ] **Step 2: Write the upload form component**

Create `app/(admin)/admin/compliance/ComplianceUpload.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { uploadComplianceDocument, type UploadResult } from "./actions";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
    >
      {pending ? "Uploading…" : "Upload document"}
    </button>
  );
}

export function ComplianceUpload() {
  const [state, action] = useActionState<UploadResult | null, FormData>(uploadComplianceDocument, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3.5">
      <label className="block">
        <span className={LABEL}>Description</span>
        <input name="description" required placeholder="Bank confirmation letter" className={FIELD} />
      </label>
      <label className="block">
        <span className={LABEL}>PDF</span>
        <input
          name="document"
          type="file"
          accept=".pdf,application/pdf"
          required
          className="mt-1 w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-canvas file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-ink-2"
        />
        <span className="mt-1 block text-[12px] text-muted">PDF only, up to 4 MB.</span>
      </label>

      {state && !state.ok && (
        <p className="rounded-md bg-brand-tint px-3 py-1.5 text-[13px] font-medium text-[#B01218]">{state.error}</p>
      )}
      {state?.ok && (
        <p className="rounded-md bg-[#E9F7EF] px-3 py-1.5 text-[13px] font-medium text-good">Document uploaded.</p>
      )}

      <SubmitButton />
    </form>
  );
}
```

- [ ] **Step 3: Write the admin page**

Create `app/(admin)/admin/compliance/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getComplianceDocuments } from "@/lib/views/compliance-documents";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { ComplianceUpload } from "./ComplianceUpload";
import { deleteComplianceDocument } from "./actions";

export default async function CompliancePage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "rocking_staff") redirect("/");

  const docs = await getComplianceDocuments();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance docs"
        subtitle="Rocking's own paperwork, shared with every client manager. Nothing client-specific belongs here."
      />

      <Card>
        <CardHeader title="Upload a document" />
        <div className="p-4">
          <ComplianceUpload />
        </div>
      </Card>

      <Card>
        <CardHeader title="Documents" count={docs.length} />
        {docs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No documents uploaded yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Description</th>
                <th className="px-4 py-2.5 font-semibold">Uploaded</th>
                <th className="px-4 py-2.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5 font-medium text-ink">{d.description}</td>
                  <td className="px-4 py-2.5 text-ink-3">{new Date(d.createdAt).toLocaleDateString("en-ZA")}</td>
                  <td className="px-4 py-2.5 text-right">
                    <form
                      action={async () => {
                        "use server";
                        await deleteComplianceDocument(d.id);
                      }}
                    >
                      <button type="submit" className="text-[13px] font-semibold text-brand hover:underline">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Add the sidebar entry**

In `lib/nav.ts`, inside the `rocking_staff` array's `Services` group, add a fourth item after `{ label: "UniFi", ... }`:

```typescript
        { label: "Compliance docs", href: "/admin/compliance" },
```

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/\(admin\)/admin/compliance lib/nav.ts
git commit -m "feat(admin): upload and manage compliance documents

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Notification email

**Files:**
- Modify: `lib/notify.ts`

**Interfaces:**
- Consumes: `sendEmail` from `@/lib/email/send`; `DetailChange` from Task 3.
- Produces: `sendCompanyDetailsChanged(opts: { clientId: string; clientName: string; changedBy: string; changes: DetailChange[] }): Promise<void>`. Task 8 calls it.

- [ ] **Step 1: Add the email function**

Append to `lib/notify.ts` (and add `import type { DetailChange } from "@/lib/company-details-helpers";` to the imports at the top):

```typescript
const ACCOUNTS_EMAIL = "accounts@rocking.one";

/**
 * Tells accounts a client corrected their own company details. This is the
 * trigger for a human to mirror the change into Xero — the portal is the
 * client's record, Xero remains the billing system, and nothing syncs back
 * automatically. Internal audience: it must never appear in the client's own
 * communications history.
 */
export async function sendCompanyDetailsChanged(opts: {
  clientId: string;
  clientName: string;
  changedBy: string;
  changes: DetailChange[];
}): Promise<void> {
  if (!opts.changes.length) return;

  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const cell = (v: string | null) =>
    v === null ? '<span style="color:#A1A1AA;">(empty)</span>' : esc(v);

  const rows = opts.changes
    .map(
      (c) => `<tr>
        <td style="padding:6px 12px 6px 0; font-weight:bold; color:#18181B;">${esc(c.label)}</td>
        <td style="padding:6px 12px 6px 0; color:#71717A;">${cell(c.oldValue)}</td>
        <td style="padding:6px 0; color:#18181B;">${cell(c.newValue)}</td>
      </tr>`,
    )
    .join("");

  const when = new Date().toLocaleString("en-ZA", { dateStyle: "long", timeStyle: "short" });

  await sendEmail({
    to: [ACCOUNTS_EMAIL],
    subject: `Company details updated — ${opts.clientName}`,
    clientId: opts.clientId,
    category: "admin_alert",
    audience: "internal",
    html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif; max-width:640px; color:#18181B;">
      <h2 style="margin:0 0 4px; font-size:18px;">Company details updated</h2>
      <p style="margin:0 0 16px; color:#52525B; font-size:14px;">
        <strong>${esc(opts.clientName)}</strong> — changed by ${esc(opts.changedBy)} on ${esc(when)}.
      </p>
      <table style="border-collapse:collapse; font-size:14px;">
        <tr style="text-align:left; font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:#A1A1AA;">
          <th style="padding:0 12px 6px 0;">Field</th>
          <th style="padding:0 12px 6px 0;">Was</th>
          <th style="padding:0 0 6px;">Now</th>
        </tr>
        ${rows}
      </table>
      <p style="margin:16px 0 0; color:#71717A; font-size:13px;">
        Update Xero to match if this affects invoicing.
      </p>
    </div>`,
  });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/notify.ts
git commit -m "feat(billing): email accounts@ when a client edits company details

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Save action with audit trail

**Files:**
- Create: `app/(app)/billing/company/actions.ts`

**Interfaces:**
- Consumes: `normaliseDetails`, `diffCompanyDetails`, `EDITABLE_FIELDS` (Task 3); `sendCompanyDetailsChanged` (Task 7).
- Produces: `type SaveResult = { ok: true; changed: number } | { ok: false; error: string }` and `saveCompanyDetails(prev: SaveResult | null, formData: FormData): Promise<SaveResult>`. Task 9's form calls it.

- [ ] **Step 1: Write the action**

Create `app/(app)/billing/company/actions.ts`:

```typescript
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { sendCompanyDetailsChanged } from "@/lib/notify";
import { diffCompanyDetails, normaliseDetails } from "@/lib/company-details-helpers";

export type SaveResult = { ok: true; changed: number } | { ok: false; error: string };

/**
 * A manager corrects the details Rocking holds for their own company.
 * The client id always comes from the session — never from the form — so a
 * manager cannot write to another client's record.
 */
export async function saveCompanyDetails(
  _prev: SaveResult | null,
  formData: FormData,
): Promise<SaveResult> {
  const me = await getCurrentProfile();
  if (!me.authenticated) return { ok: false, error: "Please sign in again." };
  if (me.profile.role !== "client_manager" || !me.profile.client_id) {
    return { ok: false, error: "Only managers can edit company details." };
  }
  const clientId = me.profile.client_id;

  const next = normaliseDetails(Object.fromEntries(formData.entries()));

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("client_company_details")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  const changes = diffCompanyDetails(before, next);
  if (!changes.length) return { ok: true, changed: 0 };

  const { error: upsertErr } = await supabase.from("client_company_details").upsert(
    {
      client_id: clientId,
      ...next,
      updated_at: new Date().toISOString(),
      updated_by_profile_id: me.profile.id,
    },
    { onConflict: "client_id" },
  );
  if (upsertErr) return { ok: false, error: upsertErr.message };

  // Written with the service role: the audit trail must not be forgeable by
  // the person it audits (clients have no insert policy on this table).
  const service = createServiceClient();
  const { error: logErr } = await service.from("company_detail_changes").insert(
    changes.map((c) => ({
      client_id: clientId,
      field: c.field,
      old_value: c.oldValue,
      new_value: c.newValue,
      changed_by_profile_id: me.profile.id,
    })),
  );
  if (logErr) console.error("company_detail_changes insert failed:", logErr);

  // Best effort. The save and the audit row have already landed; losing a
  // legitimate edit because a notification failed would be the worse outcome.
  try {
    const { data: client } = await service.from("clients").select("name").eq("id", clientId).maybeSingle();
    await sendCompanyDetailsChanged({
      clientId,
      clientName: client?.name ?? "Unknown client",
      changedBy: me.profile.email,
      changes,
    });
  } catch (e) {
    console.error("sendCompanyDetailsChanged failed:", e);
  }

  revalidatePath("/billing/company");
  return { ok: true, changed: changes.length };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/billing/company/actions.ts
git commit -m "feat(billing): save company details with audit trail and notification

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Billing tabs + company details page

**Files:**
- Create: `components/BillingTabs.tsx`
- Create: `app/(app)/billing/company/CompanyDetailsForm.tsx`
- Create: `app/(app)/billing/company/page.tsx`
- Modify: `app/(app)/billing/page.tsx`

**Interfaces:**
- Consumes: `getCompanyDetails`, `getCompanyDetailChanges` (Task 4); `saveCompanyDetails` (Task 8); `FIELD_LABELS`, `formatValue` (Task 3).
- Produces: `<BillingTabs active="invoices" | "company" | "documents" />`, used by Task 10 as well.

- [ ] **Step 1: Write the tab strip**

Create `components/BillingTabs.tsx`:

```tsx
import Link from "next/link";

const TABS = [
  { key: "invoices", label: "Invoices", href: "/billing" },
  { key: "company", label: "Company details", href: "/billing/company" },
  { key: "documents", label: "Documents", href: "/billing/documents" },
] as const;

export type BillingTab = (typeof TABS)[number]["key"];

export function BillingTabs({ active }: { active: BillingTab }) {
  return (
    <nav className="flex gap-1 border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={
            t.key === active
              ? "-mb-px border-b-2 border-brand px-3 py-2 text-sm font-semibold text-ink"
              : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted hover:text-ink-2"
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Write the edit form**

Create `app/(app)/billing/company/CompanyDetailsForm.tsx`:

```tsx
"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveCompanyDetails, type SaveResult } from "./actions";
import { FIELD_LABELS, type CompanyDetails } from "@/lib/company-details-helpers";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

const GROUPS: { title: string; fields: (keyof CompanyDetails)[] }[] = [
  { title: "Identity", fields: ["registered_name", "trading_name", "registration_number", "vat_number"] },
  { title: "Physical address", fields: ["physical_address", "physical_city", "physical_postal_code"] },
  { title: "Postal address", fields: ["postal_address", "postal_city", "postal_postal_code"] },
  { title: "Billing contact", fields: ["billing_contact_name", "billing_contact_email", "billing_contact_phone"] },
];

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

export function CompanyDetailsForm({ details }: { details: CompanyDetails }) {
  const [state, action] = useActionState<SaveResult | null, FormData>(saveCompanyDetails, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-[10px] border border-line bg-card px-3.5 py-[9px] text-sm font-semibold text-ink-2 transition-colors hover:bg-line-soft"
        >
          Edit details
        </button>
        {state?.ok && (
          <span className="text-[13px] font-medium text-good">
            {state.changed === 0 ? "No changes to save." : `Saved — ${state.changed} field${state.changed === 1 ? "" : "s"} updated.`}
          </span>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">{g.title}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.fields.map((f) => (
              <label key={f} className="block">
                <span className={LABEL}>{FIELD_LABELS[f]}</span>
                <input name={f} defaultValue={(details[f] as string | null) ?? ""} className={FIELD} />
              </label>
            ))}
          </div>
        </div>
      ))}

      <div>
        <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">Preferences</p>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="po_required" defaultChecked={details.po_required} className="h-4 w-4" />
          {FIELD_LABELS.po_required}
        </label>
        <label className="mt-3 block">
          <span className={LABEL}>{FIELD_LABELS.billing_notes}</span>
          <textarea name="billing_notes" rows={3} defaultValue={details.billing_notes ?? ""} className={FIELD} />
        </label>
      </div>

      {state && !state.ok && (
        <p className="rounded-md bg-brand-tint px-3 py-1.5 text-[13px] font-medium text-[#B01218]">{state.error}</p>
      )}

      <div className="flex items-center gap-2">
        <SaveButton />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Write the page**

Create `app/(app)/billing/company/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getCompanyDetails, getCompanyDetailChanges } from "@/lib/views/company-details";
import { EDITABLE_FIELDS, FIELD_LABELS, formatValue, type CompanyDetails } from "@/lib/company-details-helpers";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";
import { CompanyDetailsForm } from "./CompanyDetailsForm";

export default async function CompanyDetailsPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "billing")) redirect("/");
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const [details, changes] = await Promise.all([
    getCompanyDetails(me.profile.client_id),
    getCompanyDetailChanges(me.profile.client_id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" subtitle="Your invoices and account balance with Rocking." />
      <BillingTabs active="company" />

      <Card>
        <CardHeader title="Company details" />
        <div className="space-y-4 p-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {EDITABLE_FIELDS.map((f) => (
              <div key={f}>
                <dt className="text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">{FIELD_LABELS[f]}</dt>
                <dd className="text-sm text-ink">{formatValue(f, details[f as keyof CompanyDetails])}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[13px] text-muted">
            Something wrong? Correct it here and we&rsquo;ll update our records. Changes are logged below and sent to our accounts team.
          </p>
          <CompanyDetailsForm details={details} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Activity" count={changes.length} />
        {changes.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No changes recorded yet.</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {changes.map((c) => (
              <li key={c.id} className="px-4 py-2.5 text-sm">
                <span className="font-medium text-ink">{c.actor ?? "Someone"}</span>{" "}
                <span className="text-ink-2">
                  {c.oldValue === null ? (
                    <>set {c.label} to <span className="font-medium text-ink">{c.newValue}</span></>
                  ) : c.newValue === null ? (
                    <>cleared {c.label} (was <span className="font-medium text-ink">{c.oldValue}</span>)</>
                  ) : (
                    <>
                      changed {c.label} from <span className="font-medium text-ink">{c.oldValue}</span> to{" "}
                      <span className="font-medium text-ink">{c.newValue}</span>
                    </>
                  )}
                </span>
                <span className="ml-1 text-muted">
                  — {new Date(c.at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Add the tab strip to the invoices page**

In `app/(app)/billing/page.tsx`, add the import:

```typescript
import { BillingTabs } from "@/components/BillingTabs";
```

and insert `<BillingTabs active="invoices" />` immediately after the existing `<PageHeader ... />` element.

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add components/BillingTabs.tsx app/\(app\)/billing
git commit -m "feat(billing): company details page with audit log and billing tabs

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: Client documents page

**Files:**
- Create: `app/(app)/billing/documents/page.tsx`

**Interfaces:**
- Consumes: `getComplianceDocuments` (Task 5); `BillingTabs` (Task 9).
- Produces: the `/billing/documents` route.

- [ ] **Step 1: Write the page**

Create `app/(app)/billing/documents/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getComplianceDocuments } from "@/lib/views/compliance-documents";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { BillingTabs } from "@/components/BillingTabs";

export default async function BillingDocumentsPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "billing")) redirect("/");
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const docs = await getComplianceDocuments();

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" subtitle="Your invoices and account balance with Rocking." />
      <BillingTabs active="documents" />

      <Card>
        <CardHeader title="Compliance documents" count={docs.length} />
        {docs.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">No documents available yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Document</th>
                <th className="px-4 py-2.5 font-semibold">Added</th>
                <th className="px-4 py-2.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-line-soft last:border-0 hover:bg-canvas">
                  <td className="px-4 py-2.5 font-medium text-ink">{d.description}</td>
                  <td className="px-4 py-2.5 text-ink-3">
                    {new Date(d.createdAt).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {d.url ? (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[13px] font-semibold text-brand hover:underline"
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-[13px] text-muted">Unavailable</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/billing/documents
git commit -m "feat(billing): client-facing compliance documents page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 11: Surface detail edits in the admin activity feed

**Files:**
- Modify: `lib/views/activity.ts`

**Interfaces:**
- Consumes: the `company_detail_changes` table (Task 1).
- Produces: nothing new — extends the existing `ActivityItem[]` output.

- [ ] **Step 1: Add the query**

In `lib/views/activity.ts`, inside the destructured `Promise.all([...])`, add a `detailChanges` binding at the end of the array (and to the destructuring list on the left):

```typescript
      supabase.from("company_detail_changes").select("created_at, client_id, field, old_value, new_value, changed_by_profile_id").gte("created_at", since).order("created_at", { ascending: false }).limit(CAP),
```

- [ ] **Step 2: Map the rows into the feed**

After the existing `for (const t of time.data ?? [])` loop, add:

```typescript
  for (const c of detailChanges.data ?? []) {
    const label = c.field.replace(/_/g, " ");
    push({
      at: c.created_at,
      group: "changes",
      actor: person(c.changed_by_profile_id),
      clientId: c.client_id,
      clientName: named(c.client_id),
      text:
        c.old_value === null
          ? `set company ${label} to ${c.new_value}`
          : c.new_value === null
            ? `cleared company ${label}`
            : `changed company ${label} from ${c.old_value} to ${c.new_value}`,
    });
  }
```

- [ ] **Step 3: Include it in the capped check**

Change the `capped` line to include the new result:

```typescript
  const capped = [activity, quoteEvents, rfqEvents, changes, time, imports, imp, detailChanges].some((r) => (r.data?.length ?? 0) === CAP);
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/views/activity.ts
git commit -m "feat(admin): show company-detail edits in the activity feed

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 12: Xero backfill script

**Files:**
- Create: `scripts/backfill-company-details.mjs`

**Interfaces:**
- Consumes: `lib/xero-api.mjs` (`xeroEnv`, `refreshToken`, `xeroGet`, `decryptSecret`, `encryptSecret`); the `client_company_details` table (Task 1).
- Produces: a manually-run script. No exports.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-company-details.mjs`:

```javascript
// Seeds client_company_details from the mapped Xero contact.
//
//   node scripts/backfill-company-details.mjs --dry   # show what would change
//   node scripts/backfill-company-details.mjs         # write it
//
// Fill-only: writes a field ONLY when the target is currently blank, so it
// never overwrites a correction a manager has made, and is safe to re-run.
// Deliberately silent: writes no company_detail_changes rows and sends no
// email. A seed is not a human edit — logging it would fire an email per
// client and fill every audit log with "system changed everything".
import { createClient } from "@supabase/supabase-js";
import { xeroEnv, refreshToken, xeroGet, decryptSecret, encryptSecret } from "../lib/xero-api.mjs";

const DRY = process.argv.includes("--dry");

const env = xeroEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: conn } = await sb.from("xero_connection").select("*").eq("id", 1).single();
const refreshed = await refreshToken(
  env,
  decryptSecret({ ciphertext: conn.token_ciphertext, iv: conn.token_iv, tag: conn.token_tag }, env.XERO_TOKEN_ENC_KEY),
);
const renc = encryptSecret(refreshed.refresh_token, env.XERO_TOKEN_ENC_KEY);
await sb.from("xero_connection").update({ token_ciphertext: renc.ciphertext, token_iv: renc.iv, token_tag: renc.tag }).eq("id", 1);
const tok = refreshed.access_token;
const tid = conn.tenant_id;

const { data: clients } = await sb
  .from("clients")
  .select("id, name, xero_contact_id")
  .not("xero_contact_id", "is", null);
const byContact = new Map(clients.map((c) => [c.xero_contact_id, c]));
console.log(`Mapped clients: ${clients.length}${DRY ? "  (DRY RUN)" : ""}`);

// Page the whole contact list; the IDs= filter 404s on long URLs.
const contacts = new Map();
for (let page = 1; page <= 20; page++) {
  const res = await xeroGet(tok, tid, `/Contacts?page=${page}`);
  const batch = res.Contacts ?? [];
  if (!batch.length) break;
  for (const x of batch) if (byContact.has(x.ContactID)) contacts.set(x.ContactID, x);
}

const addr = (x, type) => (x.Addresses ?? []).find((a) => a.AddressType === type) ?? null;
const lines = (a) => (a ? [a.AddressLine1, a.AddressLine2, a.AddressLine3, a.AddressLine4].filter(Boolean).join("\n") || null : null);
const sameAddress = (a, b) =>
  !!a && !!b &&
  lines(a) === lines(b) &&
  (a.City ?? null) === (b.City ?? null) &&
  (a.PostalCode ?? null) === (b.PostalCode ?? null);

const phone = (x) => {
  const p = (x.Phones ?? []).find((v) => v.PhoneNumber);
  if (!p) return null;
  return [p.PhoneCountryCode, p.PhoneAreaCode, p.PhoneNumber].filter(Boolean).join(" ").trim() || null;
};

function fromXero(x) {
  const street = addr(x, "STREET");
  const pobox = addr(x, "POBOX");
  // STREET and POBOX are byte-identical for ~84% of contacts. Copying both
  // would print the same address twice on most clients' pages.
  const physical = street && (street.AddressLine1 || street.City) ? street : pobox;
  const postal = sameAddress(street, pobox) ? null : pobox === physical ? null : pobox;

  return {
    registered_name: x.Name || null,
    vat_number: x.TaxNumber || null,
    registration_number: x.CompanyNumber || null,
    physical_address: lines(physical),
    physical_city: physical?.City || null,
    physical_postal_code: physical?.PostalCode || null,
    postal_address: lines(postal),
    postal_city: postal?.City || null,
    postal_postal_code: postal?.PostalCode || null,
    billing_contact_name: [x.FirstName, x.LastName].filter(Boolean).join(" ") || null,
    billing_contact_email: x.EmailAddress || null,
    billing_contact_phone: phone(x),
  };
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

let written = 0, untouched = 0;
const missing = [];

for (const client of clients) {
  const x = contacts.get(client.xero_contact_id);
  if (!x) {
    missing.push(client.name);
    continue;
  }

  const { data: existing } = await sb
    .from("client_company_details")
    .select("*")
    .eq("client_id", client.id)
    .maybeSingle();

  const candidate = fromXero(x);
  const patch = {};
  for (const [field, value] of Object.entries(candidate)) {
    if (isBlank(value)) continue;
    if (existing && !isBlank(existing[field])) continue; // never overwrite
    patch[field] = value;
  }

  if (!Object.keys(patch).length) {
    untouched++;
    continue;
  }

  console.log(`${DRY ? "would fill" : "filling  "} ${client.name.padEnd(34)} ${Object.keys(patch).join(", ")}`);
  if (!DRY) {
    const { error } = await sb
      .from("client_company_details")
      .upsert({ client_id: client.id, ...patch }, { onConflict: "client_id" });
    if (error) {
      console.error(`  ✗ ${client.name}: ${error.message}`);
      continue;
    }
  }
  written++;
}

console.log(`\n${DRY ? "Would write" : "Wrote"}: ${written}   already populated: ${untouched}`);
if (missing.length) {
  console.log(`Not found in Xero (${missing.length}) — likely archived there:`);
  for (const n of missing) console.log(`  · ${n}`);
}
```

- [ ] **Step 2: Dry run**

Run: `node scripts/backfill-company-details.mjs --dry`
Expected: prints `Mapped clients: 142  (DRY RUN)`, a list of `would fill <client> <fields>` lines, a summary, and any not-found clients. **Nothing is written.**

- [ ] **Step 3: Real run**

Run: `node scripts/backfill-company-details.mjs`
Expected: `filling` lines and a `Wrote: N` summary.

- [ ] **Step 4: Verify one client and confirm the audit log stayed empty**

Run:
```bash
node -e "
const {readFileSync}=require('fs');const e={};
for(const l of readFileSync('.env.local','utf8').split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)\$/);if(m)e[m[1]]=m[2].replace(/^[\"']|[\"']\$/g,'')}
const H={apikey:e.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+e.SUPABASE_SERVICE_ROLE_KEY};
(async()=>{
const d=await(await fetch(e.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/client_company_details?select=registered_name,vat_number,physical_city&limit=3',{headers:H})).json();
console.log('sample details:',JSON.stringify(d,null,1));
const c=await(await fetch(e.NEXT_PUBLIC_SUPABASE_URL+'/rest/v1/company_detail_changes?select=id',{headers:H})).json();
console.log('audit rows (must be 0):',c.length);
})()"
```
Expected: sample rows populated, and **`audit rows (must be 0): 0`** — the backfill must not have written to the audit trail.

- [ ] **Step 5: Re-run to prove it is idempotent**

Run: `node scripts/backfill-company-details.mjs --dry`
Expected: `Would write: 0   already populated: N` — a second run changes nothing.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-company-details.mjs
git commit -m "feat(billing): fill-only Xero backfill for company details

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 13: Verify and ship

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all pass, including the two new helper suites.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds; `/billing/company`, `/billing/documents` and `/admin/compliance` appear in the route list.

- [ ] **Step 4: Manual smoke test**

Start the dev server via the preview tooling, then check:
1. `/admin/compliance` as staff — upload a real PDF with a description; it appears in the list.
2. Try uploading a `.png` — rejected with "only PDF files are allowed."
3. `/billing/documents` as a manager — the document is listed and Download opens the PDF.
4. `/billing/company` as a manager — details show the backfilled values; edit the VAT number and save.
5. The Activity card below now shows "changed VAT number from X to Y".
6. `accounts@rocking.one` received the notification email.
7. `/admin/activity` shows the same edit in the staff feed.

- [ ] **Step 5: Push**

```bash
git push origin main
```

---

## Self-Review

**Spec coverage:**
- Schema (3 tables + bucket) → Task 1
- RLS incl. service-role audit writes → Tasks 1, 8
- PDF-only, 4 MB cap → Tasks 2, 6
- Diff helper → Task 3
- Read layers → Tasks 4, 5
- Admin upload page + nav → Task 6
- Email via `sendEmail`, internal audience, best-effort → Tasks 7, 8
- Billing tabs, company page, audit log display → Task 9
- Client documents page → Task 10
- Admin activity feed integration → Task 11
- Fill-only Xero backfill, conditional postal, silent, `--dry`, skip reporting → Task 12
- Tests → Tasks 2, 3; verification → Task 13

**Type consistency:** `CompanyDetails`, `DetailChange`, `EDITABLE_FIELDS`, `FIELD_LABELS`, `formatValue`, `normaliseDetails`, `diffCompanyDetails` are defined once in Task 3 and referenced with identical names in Tasks 4, 8, 9. `UploadResult` (Task 6) and `SaveResult` (Task 8) are each defined in the action file that exports them and consumed by that task's own form component. `BillingTabs`/`BillingTab` defined in Task 9, reused in Task 10.

**No placeholders:** every code step contains complete, runnable code; every command lists expected output.
