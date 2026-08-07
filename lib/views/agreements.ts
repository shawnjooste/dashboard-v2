import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "agreement-pdfs";

export type AgreementRow = {
  id: string;
  reference: string;
  title: string;
  status: string;
  clientId: string;
  clientName: string;
  createdAt: string;
  sentAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  signerEmail: string | null;
  hasPdf: boolean;
};

export type AgreementDetail = AgreementRow & {
  bodyMd: string;
  signerIp: string | null;
  voidReason: string | null;
};

const SELECT =
  "id, reference, title, status, client_id, created_at, sent_at, signed_at, signer_name, signer_email, pdf_path";

type Raw = {
  id: string;
  reference: string;
  title: string;
  status: string;
  client_id: string;
  created_at: string;
  sent_at: string | null;
  signed_at: string | null;
  signer_name: string | null;
  signer_email: string | null;
  pdf_path: string | null;
};

const toRow = (a: Raw, clientName: string): AgreementRow => ({
  id: a.id,
  reference: a.reference,
  title: a.title,
  status: a.status,
  clientId: a.client_id,
  clientName,
  createdAt: a.created_at,
  sentAt: a.sent_at,
  signedAt: a.signed_at,
  signerName: a.signer_name,
  signerEmail: a.signer_email,
  hasPdf: !!a.pdf_path,
});

/** Agreements the caller may see. RLS decides: staff get everything, a
 *  client manager gets their own company's non-draft ones. */
export async function getAgreements(filters?: {
  clientId?: string;
  status?: string;
}): Promise<AgreementRow[]> {
  const supabase = await createClient();
  let q = supabase.from("agreements").select(SELECT).order("created_at", { ascending: false }).limit(500);
  if (filters?.clientId) q = q.eq("client_id", filters.clientId);
  if (filters?.status) q = q.eq("status", filters.status);
  const [{ data, error }, { data: clients }] = await Promise.all([
    q,
    supabase.from("clients").select("id, name"),
  ]);
  if (error) throw new Error(error.message);
  const name = new Map((clients ?? []).map((c) => [c.id, c.name]));
  return (data ?? []).map((a) => toRow(a as Raw, name.get((a as Raw).client_id) ?? "—"));
}

export async function getAgreement(id: string): Promise<AgreementDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("agreements")
    .select(`${SELECT}, body_md, signer_ip, void_reason`)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const raw = data as Raw & { body_md: string; signer_ip: string | null; void_reason: string | null };
  const { data: client } = await supabase
    .from("clients")
    .select("name")
    .eq("id", raw.client_id)
    .maybeSingle();
  return {
    ...toRow(raw, client?.name ?? "—"),
    bodyMd: raw.body_md,
    signerIp: raw.signer_ip,
    voidReason: raw.void_reason,
  };
}

/** A short-lived signed URL for the stored PDF. The row is read through the
 *  RLS client first, so a caller can only ever get a URL for an agreement
 *  they're allowed to see; only then does the service client sign it. */
export async function agreementPdfUrl(id: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("agreements").select("pdf_path").eq("id", id).maybeSingle();
  if (!data?.pdf_path) return null;
  const { data: signed } = await createServiceClient()
    .storage.from(BUCKET)
    .createSignedUrl(data.pdf_path, 300);
  return signed?.signedUrl ?? null;
}
