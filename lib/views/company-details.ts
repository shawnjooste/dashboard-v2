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
    else (row as unknown as Record<string, string | null>)[field] = (data as unknown as Record<string, string | null>)[field] ?? null;
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
