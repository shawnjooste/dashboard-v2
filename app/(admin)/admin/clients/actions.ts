"use server";

import { revalidatePath } from "next/cache";
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

/**
 * Staff-only: suspend a client's services, or lift the suspension. Sets the
 * standing banner every user at that client sees on every portal page.
 *
 * A NOTICE, not a gate — nothing in the portal is restricted, so a suspended
 * client can still see their bill, pay it, and reach support. Cutting support
 * off from someone mid-incident would be worse than the unpaid invoice.
 *
 * Deliberately separate from setClientArchived: 'inactive' means archived, and
 * the admin dashboard counts clients as status <> 'inactive' — overloading it
 * would hide a suspended client from staff exactly when they're being chased.
 *
 * Revalidates only THIS client's detail page so the toggle reflects the save —
 * not /admin/clients, whose re-render runs device and people queries for ~180
 * clients (see setClientArchived above). The client's own banner needs no
 * revalidation at all: their layout reads cookies, so it is dynamically
 * rendered and picks the change up on their next page load.
 */
export async function setSuspension(clientId: string, formData: FormData) {
  if (!clientId) throw new Error("missing client");

  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    throw new Error("only rocking staff may suspend clients");
  }

  const suspend = String(formData.get("suspend") ?? "") === "on";
  const note = String(formData.get("note") ?? "").trim() || null;

  const service = createServiceClient();
  const { error } = await service
    .from("clients")
    .update(
      suspend
        ? { suspended_at: new Date().toISOString(), suspension_note: note }
        : { suspended_at: null, suspension_note: null },
    )
    .eq("id", clientId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/clients/${clientId}`);
}
