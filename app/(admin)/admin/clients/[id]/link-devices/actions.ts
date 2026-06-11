"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";

async function assertStaff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    throw new Error("only rocking staff may link devices");
  }
}

/**
 * Staff-only: persist confirmed device→person links for a client. Reads every
 * `dev_<deviceId>` field from the form; an empty value clears the link. Scoped
 * to the client so a device can't be reassigned across tenants.
 */
export async function saveDeviceLinks(clientId: string, formData: FormData) {
  await assertStaff();
  const service = createServiceClient();

  const updates: PromiseLike<unknown>[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("dev_")) continue;
    const deviceId = key.slice(4);
    const personId = String(value) || null;
    updates.push(
      service.from("devices").update({ person_id: personId }).eq("id", deviceId).eq("client_id", clientId),
    );
  }
  await Promise.all(updates);

  revalidatePath(`/admin/clients/${clientId}/link-devices`);
  redirect(`/admin/clients/${clientId}/people`);
}
