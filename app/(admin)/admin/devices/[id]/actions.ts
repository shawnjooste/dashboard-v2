"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";

/** Staff-only: set or clear a single device's person link from the device card. */
export async function setDevicePerson(deviceId: string, formData: FormData) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    throw new Error("only rocking staff may link devices");
  }
  const personId = String(formData.get("person_id") ?? "") || null;
  const service = createServiceClient();
  await service.from("devices").update({ person_id: personId }).eq("id", deviceId);
  revalidatePath(`/admin/devices/${deviceId}`);
}
