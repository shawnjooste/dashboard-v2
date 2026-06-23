"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";

const BUCKET = "supplier-docs";
const DOC_TYPES = new Set(["quote", "price_list", "spec", "invoice", "other"]);

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};

export async function createSupplier(formData: FormData) {
  await staff();
  const name = str(formData, "name");
  if (!name) throw new Error("supplier name is required");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      name,
      category: str(formData, "category"),
      contact_name: str(formData, "contact_name"),
      email: str(formData, "email"),
      phone: str(formData, "phone"),
      website: str(formData, "website"),
      notes: str(formData, "notes"),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/suppliers");
  redirect(`/admin/suppliers/${data.id}`);
}

export async function updateSupplier(formData: FormData) {
  await staff();
  const id = String(formData.get("id") ?? "");
  const name = str(formData, "name");
  if (!id || !name) throw new Error("name is required");
  const supabase = await createClient();
  await supabase
    .from("suppliers")
    .update({
      name,
      category: str(formData, "category"),
      contact_name: str(formData, "contact_name"),
      email: str(formData, "email"),
      phone: str(formData, "phone"),
      website: str(formData, "website"),
      notes: str(formData, "notes"),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath(`/admin/suppliers/${id}`);
}

export type UploadResult = { ok: true } | { ok: false; error: string };

export async function uploadSupplierDocument(_prev: UploadResult | null, formData: FormData): Promise<UploadResult> {
  const me = await staff();
  const supplierId = String(formData.get("supplier_id") ?? "");
  const title = str(formData, "title");
  const file = formData.get("file");
  if (!supplierId || !title) return { ok: false, error: "A title is required." };

  // The file is optional — a document can be a metadata-only record.
  const upload = file instanceof File && file.size > 0 ? file : null;
  if (upload && upload.size > 15_000_000) return { ok: false, error: "File is over the 15 MB limit." };

  const docType = String(formData.get("doc_type") ?? "quote");
  const service = createServiceClient();
  let storagePath: string | null = null;
  if (upload) {
    const safeName = upload.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    storagePath = `${supplierId}/${crypto.randomUUID()}-${safeName}`;
    const { error: upErr } = await service.storage
      .from(BUCKET)
      .upload(storagePath, Buffer.from(await upload.arrayBuffer()), { contentType: upload.type || "application/octet-stream", upsert: false });
    if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };
  }

  const supabase = await createClient();
  const amountRaw = str(formData, "amount");
  const { error: insErr } = await supabase.from("supplier_documents").insert({
    supplier_id: supplierId,
    title,
    doc_type: DOC_TYPES.has(docType) ? docType : "other",
    reference: str(formData, "reference"),
    amount: amountRaw ? Number(amountRaw) : null,
    currency: str(formData, "currency") ?? "ZAR",
    doc_date: str(formData, "doc_date"),
    valid_until: str(formData, "valid_until"),
    notes: str(formData, "notes"),
    storage_path: storagePath,
    file_name: upload?.name ?? null,
    file_size: upload?.size ?? null,
    mime_type: upload ? upload.type || null : null,
    uploaded_by_profile_id: me.id,
  });
  if (insErr) {
    if (storagePath) await service.storage.from(BUCKET).remove([storagePath]); // no orphan file
    return { ok: false, error: insErr.message };
  }
  revalidatePath(`/admin/suppliers/${supplierId}`);
  return { ok: true };
}

export async function deleteSupplierDocument(docId: string, supplierId: string) {
  await staff();
  const supabase = await createClient();
  const { data: doc } = await supabase.from("supplier_documents").select("storage_path").eq("id", docId).maybeSingle();
  if (doc?.storage_path) await createServiceClient().storage.from(BUCKET).remove([doc.storage_path]);
  await supabase.from("supplier_documents").delete().eq("id", docId);
  revalidatePath(`/admin/suppliers/${supplierId}`);
}

/** A short-lived signed URL to open/download a document. */
export async function supplierDocumentUrl(docId: string): Promise<string | null> {
  await staff();
  const supabase = await createClient();
  const { data: doc } = await supabase.from("supplier_documents").select("storage_path").eq("id", docId).maybeSingle();
  if (!doc?.storage_path) return null;
  const { data } = await createServiceClient().storage.from(BUCKET).createSignedUrl(doc.storage_path, 60);
  return data?.signedUrl ?? null;
}

export async function deleteSupplier(id: string) {
  await staff();
  const supabase = await createClient();
  const { data: docs } = await supabase.from("supplier_documents").select("storage_path").eq("supplier_id", id);
  const paths = (docs ?? []).map((d) => d.storage_path).filter((p): p is string => !!p);
  if (paths.length) await createServiceClient().storage.from(BUCKET).remove(paths);
  await supabase.from("suppliers").delete().eq("id", id); // cascades document rows
  revalidatePath("/admin/suppliers");
  redirect("/admin/suppliers");
}
