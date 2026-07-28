"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { documentError, safeDocName } from "@/lib/compliance-helpers";

const BUCKET = "compliance-docs";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

function revalidateAll() {
  revalidatePath("/admin/compliance");
  revalidatePath("/billing/documents");
}

export type UploadResult = { ok: true } | { ok: false; error: string };

/** Staff-only. Stores one PDF with its description. The description is what
 *  clients actually read, so it is required. */
export async function uploadComplianceDocument(
  _prev: UploadResult | null,
  formData: FormData,
): Promise<UploadResult> {
  const me = await staff();

  const description = String(formData.get("description") ?? "").trim();
  if (!description) return { ok: false, error: "Give the document a description." };

  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Pick a PDF to upload." };

  const invalid = documentError(file);
  if (invalid) return { ok: false, error: invalid };

  const service = createServiceClient();
  const path = `${crypto.randomUUID()}-${safeDocName(file.name)}`;
  const { error: upErr } = await service.storage
    .from(BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, error: `Upload failed: ${upErr.message}` };

  const supabase = await createClient();
  const { error: insErr } = await supabase.from("compliance_documents").insert({
    description,
    storage_path: path,
    file_size: file.size,
    mime_type: file.type,
    uploaded_by_profile_id: me.id,
  });
  if (insErr) {
    await service.storage.from(BUCKET).remove([path]); // no orphan file
    return { ok: false, error: insErr.message };
  }

  revalidateAll();
  return { ok: true };
}

export async function deleteComplianceDocument(id: string): Promise<void> {
  await staff();
  const supabase = await createClient();
  const { data: doc } = await supabase
    .from("compliance_documents")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle();
  if (doc?.storage_path) await createServiceClient().storage.from(BUCKET).remove([doc.storage_path]);
  await supabase.from("compliance_documents").delete().eq("id", id);
  revalidateAll();
}
