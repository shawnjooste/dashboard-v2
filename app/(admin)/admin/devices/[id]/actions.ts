"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";

async function requireStaff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    throw new Error("only rocking staff may do this");
  }
  return me.profile;
}

/** Staff-only: set or clear a single device's person link from the device card. */
export async function setDevicePerson(deviceId: string, formData: FormData) {
  await requireStaff();
  const personId = String(formData.get("person_id") ?? "") || null;
  const service = createServiceClient();
  await service.from("devices").update({ person_id: personId }).eq("id", deviceId);
  revalidatePath(`/admin/devices/${deviceId}`);
}

/** Staff-only: add a manual hardware/maintenance change-log entry. */
export async function addDeviceChange(deviceId: string, formData: FormData) {
  const me = await requireStaff();
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return;
  const category = String(formData.get("category") ?? "other");
  const service = createServiceClient();
  await service.from("device_changes").insert({
    device_id: deviceId,
    category,
    note,
    created_by_profile_id: me.id,
  });
  revalidatePath(`/admin/devices/${deviceId}`);
}

/** Staff-only: remove a change-log entry. */
export async function deleteDeviceChange(changeId: string, deviceId: string) {
  await requireStaff();
  const service = createServiceClient();
  await service.from("device_changes").delete().eq("id", changeId);
  revalidatePath(`/admin/devices/${deviceId}`);
}
