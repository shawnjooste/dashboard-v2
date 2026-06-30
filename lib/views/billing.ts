import { createClient } from "@/lib/supabase/server";
import { groupInvoices } from "@/lib/xero-helpers.mjs";

export type BillingInvoice = {
  id: string;
  number: string | null;
  type: "invoice" | "credit_note";
  status: string;
  date: string | null;
  dueDate: string | null;
  total: number | null;
  amountDue: number | null;
  amountPaid: number | null;
  currency: string | null;
};

export type ClientBilling = {
  enabled: boolean;
  outstanding: number;
  overdue: number;
  currency: string | null;
  asOf: string | null;
  open: BillingInvoice[];
  paid: BillingInvoice[];
  creditNotes: BillingInvoice[];
};

const EMPTY: ClientBilling = { enabled: false, outstanding: 0, overdue: 0, currency: null, asOf: null, open: [], paid: [], creditNotes: [] };

export async function getClientBilling(clientId: string): Promise<ClientBilling> {
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("xero_contact_id").eq("id", clientId).maybeSingle();
  if (!client?.xero_contact_id) return EMPTY;

  const [{ data: summary }, { data: invoices }] = await Promise.all([
    supabase.from("client_billing").select("outstanding, overdue, currency, as_of").eq("client_id", clientId).maybeSingle(),
    supabase.from("xero_invoices").select("id, number, type, status, date, due_date, total, amount_due, amount_paid, currency").eq("client_id", clientId).order("date", { ascending: false }),
  ]);

  const mapped: BillingInvoice[] = (invoices ?? []).map((i) => ({
    id: i.id, number: i.number, type: i.type as "invoice" | "credit_note", status: i.status,
    date: i.date, dueDate: i.due_date, total: i.total, amountDue: i.amount_due, amountPaid: i.amount_paid, currency: i.currency,
  }));
  const { open, paid, creditNotes } = groupInvoices(
    mapped.map((m) => ({ ...m, amount_due: m.amountDue })),
  ) as { open: BillingInvoice[]; paid: BillingInvoice[]; creditNotes: BillingInvoice[] };

  return {
    enabled: true,
    outstanding: Number(summary?.outstanding ?? 0),
    overdue: Number(summary?.overdue ?? 0),
    currency: summary?.currency ?? mapped[0]?.currency ?? null,
    asOf: summary?.as_of ?? null,
    open, paid, creditNotes,
  };
}
