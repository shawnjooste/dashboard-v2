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
    // A missing row means the column defaults apply: po_required defaults to
    // `false` in the schema, every other column to null. Without this, the
    // first save for a client with no row yet reports a phantom
    // "PO required on invoices: → No" change.
    const previous =
      field === "po_required" ? (before?.po_required ?? false) : before ? before[field] : null;
    const oldValue = comparable(previous);
    const newValue = comparable(after[field]);
    if (oldValue === newValue) continue;
    changes.push({ field, label: FIELD_LABELS[field], oldValue, newValue });
  }
  return changes;
}
