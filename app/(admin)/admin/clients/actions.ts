"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { revalidatePath } from "next/cache";

/**
 * Staff-only: archive (status 'inactive') or restore (status 'active') a client.
 * Archiving never deletes — all the client's history stays intact, it just
 * drops out of the active list.
 */
export async function setClientArchived(formData: FormData) {
  const clientId = String(formData.get("client_id") ?? "");
  const archived = formData.get("archived") === "true";
  if (!clientId) throw new Error("missing client");

  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    throw new Error("only rocking staff may archive clients");
  }

  const service = createServiceClient();
  const { error } = await service
    .from("clients")
    .update({ status: archived ? "inactive" : "active" })
    .eq("id", clientId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/clients");
}
