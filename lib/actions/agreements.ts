"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getCurrentProfile } from "@/lib/auth/profile";
import { buildAgreementPdf } from "@/lib/agreements/pdf";
import { getAgreementRecipients, agreementPdfUrl } from "@/lib/views/agreements";
import { sendAgreementForSignature, notifyAgreementSigned } from "@/lib/notify";

const BUCKET = "agreement-pdfs";

async function staff() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") throw new Error("staff only");
  return me.profile;
}

const str = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v || null;
};

export async function createAgreement(formData: FormData) {
  const me = await staff();
  const clientId = str(formData, "client_id");
  const title = str(formData, "title");
  const bodyMd = String(formData.get("body_md") ?? "");
  if (!clientId || !title) throw new Error("pick a client and give the agreement a title");
  if (!bodyMd.trim()) throw new Error("an agreement needs a body");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .insert({ client_id: clientId, title, body_md: bodyMd, created_by_profile_id: me.id })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/admin/agreements");
  redirect(`/admin/agreements/${data.id}`);
}

/** Drafts only — a sent agreement's wording is what the client was asked to
 *  sign, and a signed one is frozen by the database itself. */
export async function updateDraft(id: string, formData: FormData) {
  await staff();
  const title = str(formData, "title");
  const bodyMd = String(formData.get("body_md") ?? "");
  if (!title || !bodyMd.trim()) throw new Error("title and body are both required");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .update({ title, body_md: bodyMd })
    .eq("id", id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("only a draft can be edited");
  revalidatePath(`/admin/agreements/${id}`);
}

export async function sendAgreement(id: string) {
  await staff();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft")
    .select("id, reference, title, client_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("only a draft can be sent");

  // Notify the client's managers. Best-effort: the agreement IS sent — a mail
  // failure must not roll that back or leave the UI claiming otherwise.
  try {
    const service = createServiceClient();
    // Same recipient rule the detail page showed before you clicked send.
    const [recipients, { data: client }] = await Promise.all([
      getAgreementRecipients(data.client_id),
      service.from("clients").select("name").eq("id", data.client_id).maybeSingle(),
    ]);
    await sendAgreementForSignature({
      to: recipients,
      reference: data.reference,
      title: data.title,
      companyName: client?.name ?? "your company",
      agreementId: data.id,
      clientId: data.client_id,
    });
  } catch (e) {
    console.error("agreement send email failed:", e);
  }

  revalidatePath("/admin/agreements");
  revalidatePath(`/admin/agreements/${id}`);
}

export async function voidAgreement(id: string, formData: FormData) {
  await staff();
  const reason = str(formData, "void_reason");
  if (!reason) throw new Error("give a reason so the record explains itself");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agreements")
    .update({ status: "void", void_reason: reason })
    .eq("id", id)
    .in("status", ["draft", "sent"])
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("a signed agreement cannot be voided");
  revalidatePath("/admin/agreements");
  revalidatePath(`/admin/agreements/${id}`);
}

export type SignResult = { ok: true } | { ok: false; error: string };

/**
 * The client's signature. Authorisation, the status transition and the
 * signature columns all happen inside the sign_agreement RPC, atomically —
 * two managers clicking at once cannot both sign.
 *
 * Ordering matters: the signature is the legal event and the PDF is an
 * artefact of it, so the PDF is generated AFTER the transition succeeds and
 * its failure is logged, never surfaced as a failed signature.
 */
export async function signAgreement(id: string, _prev: SignResult | null, formData: FormData): Promise<SignResult> {
  const me = await getCurrentProfile();
  if (!me.authenticated) return { ok: false, error: "Please sign in again." };
  const signerName = String(formData.get("signer_name") ?? "").trim();
  if (!signerName) return { ok: false, error: "Type your full name to sign." };
  if (formData.get("intent") !== "on") return { ok: false, error: "Tick the box to confirm you intend to sign." };

  // Blank means "not captured" — the RPC normalises it back to NULL.
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ua = h.get("user-agent") ?? "";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sign_agreement", {
    p_agreement_id: id,
    p_signer_name: signerName,
    p_ip: ip,
    p_user_agent: ua,
  });
  if (error) return { ok: false, error: error.message };
  const signed = (Array.isArray(data) ? data[0] : data) as {
    id: string;
    reference: string;
    title: string;
    body_md: string;
    client_id: string;
    signer_name: string;
    signer_email: string;
    signed_at: string;
    signer_ip: string | null;
  } | null;
  if (!signed) return { ok: false, error: "This agreement is not available for you to sign." };

  // Everything past this point is bookkeeping on an already-valid signature.
  try {
    const service = createServiceClient();
    const { data: client } = await service
      .from("clients")
      .select("name")
      .eq("id", signed.client_id)
      .maybeSingle();
    const companyName = client?.name ?? "the client";

    const pdf = await buildAgreementPdf({
      reference: signed.reference,
      title: signed.title,
      bodyMd: signed.body_md,
      clientName: companyName,
      signerName: signed.signer_name,
      signerEmail: signed.signer_email,
      signedAt: signed.signed_at,
      signerIp: signed.signer_ip,
    });
    const path = `${signed.client_id}/${signed.id}.pdf`;
    const { error: upErr } = await service.storage
      .from(BUCKET)
      .upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
    if (upErr) throw upErr;
    // pdf_path is deliberately NOT frozen by the trigger — this is the one
    // write a signed row still accepts.
    await service.from("agreements").update({ pdf_path: path }).eq("id", signed.id);

    await notifyAgreementSigned({
      reference: signed.reference,
      title: signed.title,
      companyName,
      signerName: signed.signer_name,
      signerEmail: signed.signer_email,
      agreementId: signed.id,
      clientId: signed.client_id,
    });
  } catch (e) {
    console.error("agreement post-signature steps failed:", e);
  }

  revalidatePath("/agreements");
  revalidatePath(`/agreements/${id}`);
  revalidatePath(`/admin/agreements/${id}`);
  return { ok: true };
}

/** Server-side redirect to a short-lived signed URL, so the PDF link is never
 *  a long-lived public URL sitting in the page source. */
export async function downloadAgreementPdf(id: string) {
  const url = await agreementPdfUrl(id);
  if (!url) throw new Error("no PDF is available for this agreement");
  redirect(url);
}
