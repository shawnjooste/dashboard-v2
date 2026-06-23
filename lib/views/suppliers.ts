import { createClient } from "@/lib/supabase/server";

export type DocType = "quote" | "price_list" | "spec" | "invoice" | "other";
export const DOC_TYPE_LABEL: Record<DocType, string> = {
  quote: "Quote",
  price_list: "Price list",
  spec: "Spec sheet",
  invoice: "Invoice",
  other: "Other",
};

export type SupplierRow = {
  id: string;
  name: string;
  category: string | null;
  contactName: string | null;
  email: string | null;
  docCount: number;
  latestDocDate: string | null;
};

export type SupplierDoc = {
  id: string;
  title: string;
  docType: DocType;
  reference: string | null;
  amount: number | null;
  currency: string;
  docDate: string | null;
  validUntil: string | null;
  notes: string | null;
  fileName: string | null;
  fileSize: number | null;
  createdAt: string;
};

export type SupplierDetail = {
  id: string;
  name: string;
  category: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  documents: SupplierDoc[];
};

export async function getSuppliers(): Promise<SupplierRow[]> {
  const supabase = await createClient();
  const [{ data: sups }, { data: docs }] = await Promise.all([
    supabase.from("suppliers").select("id, name, category, contact_name, email").order("name"),
    supabase.from("supplier_documents").select("supplier_id, doc_date, created_at"),
  ]);
  const byId = new Map<string, { count: number; latest: string | null }>();
  for (const d of docs ?? []) {
    const e = byId.get(d.supplier_id) ?? { count: 0, latest: null };
    e.count++;
    const dt = d.doc_date ?? d.created_at?.slice(0, 10) ?? null;
    if (dt && (!e.latest || dt > e.latest)) e.latest = dt;
    byId.set(d.supplier_id, e);
  }
  return (sups ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    contactName: s.contact_name,
    email: s.email,
    docCount: byId.get(s.id)?.count ?? 0,
    latestDocDate: byId.get(s.id)?.latest ?? null,
  }));
}

export async function getSupplierDetail(id: string): Promise<SupplierDetail | null> {
  const supabase = await createClient();
  const { data: s } = await supabase.from("suppliers").select("*").eq("id", id).maybeSingle();
  if (!s) return null;
  const { data: docs } = await supabase
    .from("supplier_documents")
    .select("id, title, doc_type, reference, amount, currency, doc_date, valid_until, notes, file_name, file_size, created_at")
    .eq("supplier_id", id)
    .order("created_at", { ascending: false });
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    contactName: s.contact_name,
    email: s.email,
    phone: s.phone,
    website: s.website,
    notes: s.notes,
    documents: (docs ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      docType: d.doc_type as DocType,
      reference: d.reference,
      amount: d.amount === null ? null : Number(d.amount),
      currency: d.currency,
      docDate: d.doc_date,
      validUntil: d.valid_until,
      notes: d.notes,
      fileName: d.file_name,
      fileSize: d.file_size,
      createdAt: d.created_at,
    })),
  };
}
