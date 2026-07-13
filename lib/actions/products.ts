"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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

// ---------- catalog ----------

export async function createProduct(formData: FormData) {
  await staff();
  const name = str(formData, "name");
  if (!name) throw new Error("product name is required");
  const supabase = await createClient();
  const { error } = await supabase.from("products").insert({ name, description: str(formData, "description") });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/products");
}

export async function updateProduct(formData: FormData) {
  await staff();
  const id = String(formData.get("id") ?? "");
  const name = str(formData, "name");
  if (!id || !name) throw new Error("product name is required");
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ name, description: str(formData, "description") })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/products");
}

export async function toggleProductActive(productId: string, isActive: boolean) {
  await staff();
  const supabase = await createClient();
  await supabase.from("products").update({ is_active: isActive }).eq("id", productId);
  revalidatePath("/admin/products");
}

// ---------- per-client allocation ----------

export async function addClientProduct(clientId: string, formData: FormData) {
  await staff();
  const productId = String(formData.get("product_id") ?? "");
  if (!productId) throw new Error("pick a product");
  const quantity = Number(formData.get("quantity") ?? 1);
  const supabase = await createClient();
  const { error } = await supabase.from("client_products").insert({
    client_id: clientId,
    product_id: productId,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
    note: str(formData, "note"),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/services");
}

export async function updateClientProduct(allocationId: string, clientId: string, formData: FormData) {
  await staff();
  const quantity = Number(formData.get("quantity") ?? 1);
  const supabase = await createClient();
  const { error } = await supabase
    .from("client_products")
    .update({
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
      note: str(formData, "note"),
    })
    .eq("id", allocationId);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/services");
}

export async function removeClientProduct(allocationId: string, clientId: string) {
  await staff();
  const supabase = await createClient();
  await supabase.from("client_products").delete().eq("id", allocationId);
  revalidatePath(`/admin/clients/${clientId}`);
  revalidatePath("/services");
}
