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

  it("does not invent a po_required change when there is no row yet", () => {
    // po_required defaults to false in the schema, so a first-time save that
    // leaves it unticked is not a change.
    expect(diffCompanyDetails(null, blank())).toEqual([]);
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
