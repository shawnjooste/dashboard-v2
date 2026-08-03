"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";

/**
 * Staff-only: archive (status 'inactive') or restore (status 'active') a client.
 * Archiving never deletes — all the client's history stays intact, it just
 * drops out of the active list.
 *
 * Deliberately does NOT revalidatePath("/admin/clients"): every admin page is
 * dynamically rendered (lib/supabase/server reads cookies), so a fresh request
 * always re-reads the truth and there is no cache to bust. Revalidating only
 * forced the router to re-fetch the whole route — re-running the device and
 * people queries for ~180 clients and re-rendering every row — which threw
 * away the scroll position of whoever was working down the list. The caller
 * updates the row locally instead.
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
}
