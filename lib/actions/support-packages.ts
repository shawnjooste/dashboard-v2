"use server";

import { revalidatePath } from "next/cache";
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
