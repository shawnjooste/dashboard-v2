import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "compliance-docs";

export type ComplianceDocument = {
  id: string;
  description: string;
  createdAt: string;
  fileSize: number | null;
  url: string | null;
};

/**
 * Rocking's compliance documents, newest first. The select runs under the
 * caller's RLS (every signed-in user may read them), and URLs are only signed
 * for rows RLS actually returned — so the signed URLs inherit the same access
 * control. URLs last one hour, i.e. one server render.
 */
export async function getComplianceDocuments(): Promise<ComplianceDocument[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("compliance_documents")
    .select("id, description, storage_path, file_size, created_at")
    .order("created_at", { ascending: false });
  if (!data?.length) return [];

  const { data: signed } = await createServiceClient()
    .storage.from(BUCKET)
    .createSignedUrls(data.map((d) => d.storage_path), 3600);
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return data.map((d) => ({
    id: d.id,
    description: d.description,
    createdAt: d.created_at,
    fileSize: d.file_size,
    url: urlByPath.get(d.storage_path) ?? null,
  }));
}
