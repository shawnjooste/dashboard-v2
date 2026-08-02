"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};

/** Edit a package's display name, allowance, SLA and flags (data, not code). */
export async function savePackage(formData: FormData) {
  await staff();
  const id = String(formData.get("id") ?? "");
  const name = str(formData, "name");
  const hours = Number(formData.get("included_hours") ?? 0);
  const sla = str(formData, "sla_hours");
  if (!id || !name || !Number.isFinite(hours) || hours < 0) throw new Error("invalid package");
  const supabase = await createClient();
  const { error } = await supabase
    .from("support_packages")
    .update({
      name,
      included_minutes: Math.round(hours * 60),
      sla_hours: sla ? Number(sla) : null,
      has_chat: formData.get("has_chat") === "on",
      remote_included: formData.get("remote_included") === "on",
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/support-packages");
}

/** Assign a client's package + plan label. Staff-only by guard AND by using
 *  the service client — clients.support_* columns have no client-write path. */
export async function assignClientPackage(clientId: string, formData: FormData) {
  await staff();
  const packageId = str(formData, "package_id");
  const service = createServiceClient();
  const { error } = await service
    .from("clients")
    .update({ support_package_id: packageId, support_plan_label: str(formData, "plan_label") })
    .eq("id", clientId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/support");
}

/**
 * Bulk tier assignment: one pass over every client. Only rows that actually
 * changed are written — with ~180 clients, updating all of them on every save
 * would be slow and would churn rows nobody touched.
 */
export async function bulkAssignPackages(formData: FormData) {
  await staff();
  const service = createServiceClient();
  const { data: current } = await service
    .from("clients")
    .select("id, support_package_id, support_plan_label");

  const { data: pkgs } = await service.from("support_packages").select("id, is_default");
  const validPkgIds = new Set((pkgs ?? []).map((p) => p.id));
  const defaultPkgId = (pkgs ?? []).find((p) => p.is_default)?.id ?? null;

  let changed = 0;
  let paid = 0;
  for (const c of current ?? []) {
    const rawPkg = formData.get(`pkg_${c.id}`);
    if (rawPkg == null) continue; // client wasn't on the submitted page
    const submitted = String(rawPkg);
    // Guard against a stale or malformed id silently demoting someone to the
    // default tier — the failure mode we hit was "everything became Standard".
    const nextPkg = validPkgIds.has(submitted) ? submitted : c.support_package_id;
    const nextLabel = String(formData.get(`label_${c.id}`) ?? "").trim() || null;
    if (nextPkg && nextPkg !== defaultPkgId) paid++;
    if (nextPkg === c.support_package_id && nextLabel === c.support_plan_label) continue;
    const { error } = await service
      .from("clients")
      .update({ support_package_id: nextPkg, support_plan_label: nextLabel })
      .eq("id", c.id);
    if (error) throw new Error(`${c.id}: ${error.message}`);
    changed++;
  }

  console.log(`bulk tier assignment: ${changed} changed, ${paid} on a paid tier`);
  revalidatePath("/admin/support-packages");
  revalidatePath("/admin/support-packages/assign");
  revalidatePath("/support");
  // Redirect with the outcome so the result is unmistakable — the previous
  // version gave no feedback at all, which is why a working save read as broken.
  redirect(`/admin/support-packages/assign?changed=${changed}&paid=${paid}`);
}

export async function addTimeEntry(clientId: string, formData: FormData) {
  const me = await staff();
  const minutes = Number(formData.get("minutes"));
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error("minutes must be positive");
  const workType = String(formData.get("work_type") ?? "ticket");
  const fsNum = str(formData, "freescout_number");
  const supabase = await createClient();
  const { error } = await supabase.from("support_time_entries").insert({
    client_id: clientId,
    minutes: Math.round(minutes),
    work_type: ["ticket", "remote", "onsite", "other"].includes(workType) ? workType : "other",
    note: str(formData, "note"),
    freescout_number: fsNum ? Number(fsNum) : null,
    entered_by: me.id,
    occurred_on: str(formData, "occurred_on") ?? undefined,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin/support-packages");
}

export async function deleteTimeEntry(entryId: string, clientId: string) {
  await staff();
  const supabase = await createClient();
  await supabase.from("support_time_entries").delete().eq("id", entryId);
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/admin/support-packages");
}
