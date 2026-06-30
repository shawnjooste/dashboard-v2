// Pull invoices + credit notes for mapped clients into the Portal. Idempotent.
//   node scripts/xero-pull.mjs <clientId>
//   node scripts/xero-pull.mjs --all
import { createClient } from "@supabase/supabase-js";
import { xeroEnv, refreshToken, xeroGet, decryptSecret, encryptSecret } from "../lib/xero-api.mjs";
import { normalizeInvoice, isVisibleStatus, summarize } from "../lib/xero-helpers.mjs";

const arg = process.argv[2];
if (!arg) { console.error("Usage: node scripts/xero-pull.mjs <clientId>|--all"); process.exit(1); }

const env = xeroEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const today = new Date().toISOString().slice(0, 10);

const { data: conn } = await sb.from("xero_connection").select("*").eq("id", 1).maybeSingle();
if (!conn) { console.error("No Xero connection — run xero-connect first."); process.exit(1); }

let access;
try {
  const refreshed = await refreshToken(env, decryptSecret({ ciphertext: conn.token_ciphertext, iv: conn.token_iv, tag: conn.token_tag }, env.XERO_TOKEN_ENC_KEY));
  access = refreshed.access_token;
  const renc = encryptSecret(refreshed.refresh_token, env.XERO_TOKEN_ENC_KEY);
  await sb.from("xero_connection").update({ token_ciphertext: renc.ciphertext, token_iv: renc.iv, token_tag: renc.tag, status: "connected" }).eq("id", 1);
} catch (e) {
  if (e.code === "invalid_grant") { await sb.from("xero_connection").update({ status: "reauth_required" }).eq("id", 1); console.error("✗ Xero token expired — run xero-connect."); process.exit(1); }
  throw e;
}

let q = sb.from("clients").select("id, name, xero_contact_id").not("xero_contact_id", "is", null);
if (arg !== "--all") q = q.eq("id", arg);
const { data: clients } = await q;
if (!clients?.length) { console.error("No mapped clients to pull."); process.exit(0); }

const { data: run } = await sb.from("import_runs").insert({ source: "xero", report_date: today, file_names: [] }).select("id").single();

async function pageAll(path) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const res = await xeroGet(access, conn.tenant_id, `${path}${path.includes("?") ? "&" : "?"}page=${page}`);
    const batch = res.Invoices ?? res.CreditNotes ?? [];
    out.push(...batch);
    if (batch.length < 100) return out;
  }
  console.warn(`WARNING: hit the 20-page (2000-doc) cap for ${path} — results may be truncated.`);
  return out;
}

for (const c of clients) {
  try {
    const rawInv = await pageAll(`/Invoices?where=${encodeURIComponent(`Contact.ContactID==Guid("${c.xero_contact_id}") AND Type=="ACCREC"`)}&Statuses=AUTHORISED,PAID`);
    const rawCn = await pageAll(`/CreditNotes?where=${encodeURIComponent(`Contact.ContactID==Guid("${c.xero_contact_id}") AND Type=="ACCRECCREDIT"`)}`);
    const invoices = [
      ...rawInv.filter((i) => isVisibleStatus(i.Status)).map((i) => normalizeInvoice(i, "invoice")),
      ...rawCn.filter((i) => isVisibleStatus(i.Status)).map((i) => normalizeInvoice(i, "credit_note")),
    ];

    // Replace this client's invoices with the current set.
    await sb.from("xero_invoices").delete().eq("client_id", c.id);
    if (invoices.length) {
      await sb.from("xero_invoices").insert(invoices.map((i) => ({ ...i, client_id: c.id, import_run_id: run.id })));
    }
    const s = summarize(invoices, today);
    await sb.from("client_billing").upsert({
      client_id: c.id, outstanding: s.outstanding, overdue: s.overdue,
      currency: s.currency, as_of: today, updated_at: new Date().toISOString(),
    });
    console.log(`✓ ${c.name}: ${invoices.length} docs, outstanding ${s.currency ?? ""} ${s.outstanding} (${s.overdue} overdue)`);
  } catch (e) {
    console.error(`✗ ${c.name}: ${e.message}`);
  }
}
await sb.from("xero_connection").update({ last_pull_at: new Date().toISOString() }).eq("id", 1);
