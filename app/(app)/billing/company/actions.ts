"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
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
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "billing")) {
    return { ok: false, error: "Billing is not enabled for your account." };
  }
  const clientId = me.profile.client_id;

  const next = normaliseDetails(Object.fromEntries(formData.entries()));

  const supabase = await createClient();
  const { data: before, error: readErr } = await supabase
    .from("client_company_details")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  // Without the current row we cannot diff, and the upsert writes all 15
  // columns — so proceeding would blank every field the form left empty
  // while logging nothing. Fail closed instead.
  if (readErr) return { ok: false, error: "Could not load your current details. Please try again." };

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
