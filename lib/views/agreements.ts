import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { canAccess, toOverrides } from "@/lib/feature-access";

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

/** Who will receive the "please sign" email — shown on the staff detail page
 *  before sending, so recipients are never a surprise. Must match the query in
 *  sendAgreement(). */
export async function getAgreementRecipients(clientId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("email, feature_overrides")
    .eq("client_id", clientId)
    .eq("role", "client_manager")
    .eq("status", "active")
    .order("email");
  // Someone whose agreements access is switched off would only be bounced off
  // the page the email links to — don't email them.
  return (data ?? [])
    .filter((p) => canAccess("client_manager", toOverrides(p.feature_overrides), "agreements"))
    .map((p) => p.email);
}

/** Active clients, for the "who is this agreement with" picker. Deliberately
 *  not getClientSummaries() — that only returns clients that have devices, and
 *  an agreement can be with any client. */
export async function getAgreementClients(): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name")
    .eq("status", "active")
    .order("name");
  return data ?? [];
}

/** A short-lived signed URL for the stored PDF. The row is read through the
 *  RLS client first, so a caller can only ever get a URL for an agreement
 *  they're allowed to see; only then does the service client sign it.
 *
 *  Signing deliberately treats PDF generation as best-effort, so a signed
 *  agreement can exist with no stored PDF. Rather than leave that client
 *  permanently without a copy, the PDF is rebuilt here on first request — the
 *  frozen row means a rebuild is byte-for-byte the same document. */
export async function agreementPdfUrl(id: string): Promise<string | null> {
  // Authorisation first, through RLS: no row here means no URL, whatever the
  // service client could reach.
  const supabase = await createClient();
  const { data } = await supabase.from("agreements").select("id").eq("id", id).maybeSingle();
  if (!data) return null;

  const path = await ensureAgreementPdf(id);
  if (!path) return null;
  const { data: signed } = await createServiceClient().storage.from(BUCKET).createSignedUrl(path, 300);
  return signed?.signedUrl ?? null;
}

/** The stored PDF's path, generating it if a signed agreement has none.
 *  Service-role only and deliberately free of request context, so it is
 *  callable from scripts and jobs as well as from a page — callers are
 *  responsible for authorising first. */
export async function ensureAgreementPdf(id: string): Promise<string | null> {
  const service = createServiceClient();
  const { data } = await service
    .from("agreements")
    .select(`${SELECT}, body_md, signer_ip`)
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as Raw & { body_md: string; signer_ip: string | null };
  if (row.pdf_path) return row.pdf_path;
  if (row.status !== "signed") return null;

  try {
    const { buildAgreementPdf } = await import("@/lib/agreements/pdf");
    const { data: client } = await service.from("clients").select("name").eq("id", row.client_id).maybeSingle();
    const pdf = await buildAgreementPdf({
      reference: row.reference,
      title: row.title,
      bodyMd: row.body_md,
      clientName: client?.name ?? "the client",
      signerName: row.signer_name ?? "",
      signerEmail: row.signer_email ?? "",
      signedAt: row.signed_at ?? new Date().toISOString(),
      signerIp: row.signer_ip,
    });
    const path = `${row.client_id}/${row.id}.pdf`;
    const { error } = await service.storage
      .from(BUCKET)
      .upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
    if (error) throw error;
    await service.from("agreements").update({ pdf_path: path }).eq("id", row.id);
    return path;
  } catch (e) {
    console.error("agreement PDF regeneration failed:", e);
    return null;
  }
}
