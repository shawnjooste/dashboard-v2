"use server";

import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { revalidatePath } from "next/cache";

/**
 * Staff-only: mark an accepted quote as invoiced (or clear it). Stamps
 * invoiced_at so the admin quotes worklist separates "to invoice" from done.
 */
export async function setQuoteInvoiced(formData: FormData) {
  const quoteId = String(formData.get("quote_id") ?? "");
  const invoiced = formData.get("invoiced") === "true";
  if (!quoteId) throw new Error("missing quote");

  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") {
    throw new Error("only rocking staff may update invoicing");
  }

  const service = createServiceClient();
  const { error } = await service
    .from("quotes")
    .update({ invoiced_at: invoiced ? new Date().toISOString() : null })
    .eq("id", quoteId);
  if (error) throw new Error(error.message);

  revalidatePath("/admin/quotes");
}
