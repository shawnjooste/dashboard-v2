// Creates (or amends) a quote from a JSON file and emails the client's managers.
//
//   node scripts/create-quote.mjs quote.json            # new quote, status sent
//   node scripts/create-quote.mjs quote.json --amend <quoteId>   # new version
//   ... --no-email                                      # import silently
//   ... --pending-review                                # status pending_review, notify
//                                                        #   shawn@/kelle@rocking.one instead of
//                                                        #   emailing the client — for quotes built
//                                                        #   without a human already having reviewed
//                                                        #   them (e.g. the automated inbound-email
//                                                        #   pipeline). Approve-and-send happens from
//                                                        #   the admin quote page.
//
// Input file:
// {
//   "clientId": "..."            // or "clientName": "GSR Law"
//   "title": "VoIP Phone System",
//   "validUntil": "2026-07-11",  // ISO date for expiry derivation
//   "number": "QU-GSR-002",      // optional: keep an existing number (skips the counter)
//   "doc": { ...QuoteDoc shape (lib/quotes/doc.ts); meta.quoteNumber is filled in here },
//   "internal": [{ "path": "s0.g0.i0", "supplierCost": 850, "note": "Miro invoice #123" }]
//   // supplierCost convention: ex-VAT LINE TOTAL (incl-VAT cost / 1.15 × qty)
// }

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// ---------- env ----------
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

// ---------- totals (keep in sync with lib/quotes/doc.ts computeTotals) ----------
function computeTotals(doc) {
  const rate = doc.vatPercent / 100;
  let subtotal = 0, vat = 0, monthly = null;
  for (const s of doc.sections) {
    let secSub = 0;
    for (const g of s.groups)
      for (const it of g.items)
        if (it.qty != null && it.unitPrice != null) secSub += it.qty * it.unitPrice;
    const secGrand = secSub * (1 + rate);
    if (s.monthly ?? s.id === "recurring") monthly = (monthly ?? 0) + secGrand;
    else { subtotal += secSub; vat += secSub * rate; }
  }
  return { subtotal, vat, grand: subtotal + vat, monthly };
}
const fmtMoney = (n) =>
  "R " + Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- args ----------
const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error("usage: node scripts/create-quote.mjs <quote.json> [--amend <quoteId>]"); process.exit(1); }
const amendIdx = rest.indexOf("--amend");
const amendId = amendIdx !== -1 ? rest[amendIdx + 1] : null;
const noEmail = rest.includes("--no-email");
const pendingReview = rest.includes("--pending-review");
const initialStatus = pendingReview ? "pending_review" : "sent";
const input = JSON.parse(readFileSync(file, "utf8"));
const { doc, internal = [], title, validUntil } = input;
if (!doc || !title) { console.error("input needs { title, doc }"); process.exit(1); }

// ---------- resolve client ----------
let clientId = input.clientId ?? null;
if (!clientId && input.clientName) {
  const { data } = await sb.from("clients").select("id, name").ilike("name", input.clientName);
  if (!data || data.length !== 1) {
    console.error(`client "${input.clientName}" matched ${data?.length ?? 0} rows`); process.exit(1);
  }
  clientId = data[0].id;
}
if (!clientId) { console.error("input needs clientId or clientName"); process.exit(1); }

const totals = computeTotals(doc);

let quoteId, quoteNumber, version;

if (amendId) {
  // ---------- new version of an existing quote ----------
  const { data: q, error } = await sb.from("quotes")
    .select("id, client_id, quote_number, status, current_version").eq("id", amendId).single();
  if (error || !q) { console.error("quote not found:", amendId); process.exit(1); }
  if (!["sent", "changes_requested", "rejected"].includes(q.status)) {
    console.error(`cannot amend a quote in status "${q.status}"`); process.exit(1);
  }
  quoteId = q.id; quoteNumber = q.quote_number; version = q.current_version + 1;
  doc.meta.quoteNumber = quoteNumber;

  const { data: v, error: vErr } = await sb.from("quote_versions").insert({
    quote_id: quoteId, version, doc,
    subtotal: totals.subtotal, vat_amount: totals.vat, grand_total: totals.grand,
    monthly_total: totals.monthly, valid_until: validUntil ?? null,
  }).select("id").single();
  if (vErr) throw vErr;
  await insertInternal(v.id);
  const { error: uErr } = await sb.from("quotes")
    .update({ current_version: version, status: initialStatus, title }).eq("id", quoteId);
  if (uErr) throw uErr;
  await sb.from("quote_events").insert({ quote_id: quoteId, version, event: initialStatus });
} else {
  // ---------- brand-new quote ----------
  if (input.number) {
    quoteNumber = input.number; // imported historical quote keeps its number
  } else {
    const { data: num, error: numErr } = await sb.rpc("next_quote_number");
    if (numErr) throw numErr;
    quoteNumber = num;
  }
  version = 1;
  doc.meta.quoteNumber = quoteNumber;

  const { data: q, error: qErr } = await sb.from("quotes").insert({
    client_id: clientId, quote_number: quoteNumber, title, status: initialStatus,
  }).select("id").single();
  if (qErr) throw qErr;
  quoteId = q.id;

  const { data: v, error: vErr } = await sb.from("quote_versions").insert({
    quote_id: quoteId, version: 1, doc,
    subtotal: totals.subtotal, vat_amount: totals.vat, grand_total: totals.grand,
    monthly_total: totals.monthly, valid_until: validUntil ?? null,
  }).select("id").single();
  if (vErr) throw vErr;
  await insertInternal(v.id);
  await sb.from("quote_events").insert([
    { quote_id: quoteId, version: 1, event: "created" },
    { quote_id: quoteId, version: 1, event: initialStatus },
  ]);
}

async function insertInternal(versionId) {
  if (!internal.length) return;
  const rows = internal.map((r) => ({
    version_id: versionId, line_path: r.path, supplier_cost: r.supplierCost ?? null, note: r.note ?? null,
  }));
  const { error } = await sb.from("quote_internal").insert(rows);
  if (error) throw error;
}

// ---------- notify managers ----------
const { data: managers } = await sb.from("profiles").select("email")
  .eq("client_id", clientId).eq("role", "client_manager").eq("status", "active");
const to = (managers ?? []).map((m) => m.email);
const url = `${APP_URL}/quotes/${quoteId}`;

if (noEmail) {
  console.log("Email skipped (--no-email)");
} else if (pendingReview) {
  const reviewUrl = `${APP_URL}/admin/quotes/${quoteId}`;
  const reviewers = ["shawn@rocking.one", "kelle@rocking.one"];
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: '"Rocky @ Rocking" <quotes@send.rocking.one>',
      to: reviewers, subject: `Quote ${quoteNumber} ready for review — ${doc.client.name}`,
      html: `
        <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px;">
          <h2 style="margin:0 0 8px;">Quote ready for review</h2>
          <p style="color:#444; margin:0 0 16px;">
            I've built a quote from a supplier reply and it's ready to go out, but it hasn't been sent yet:
            <strong>${title}</strong> for <strong>${doc.client.name}</strong> — ${fmtMoney(totals.grand)} incl VAT${totals.monthly != null ? ` + ${fmtMoney(totals.monthly)} / month` : ""}.
            Take a look and approve it to send.
          </p>
          <p style="margin:20px 0 0;">
            <a href="${reviewUrl}" style="background:#D7141C; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">Review the quote</a>
          </p>
          <p style="margin:24px 0 0; color:#888; font-size:12.5px;">— Rocky</p>
        </div>`,
    }),
  });
  console.log(res.ok ? `Review requested from ${reviewers.join(", ")}` : `EMAIL FAILED (${res.status}) — quote still created, pending review`);
} else if (to.length && process.env.RESEND_API_KEY) {
  const heading = amendId
    ? `Updated quote from Rocking — ${quoteNumber}`
    : `New quote from Rocking — ${quoteNumber}`;
  const clientHtml = `
        <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 520px;">
          <h2 style="margin:0 0 8px;">${heading}</h2>
          <p style="color:#444; margin:0 0 16px;">
            ${amendId ? "We've revised a quote for you" : "We've prepared a quote for you"}:
            <strong>${title}</strong> — ${fmtMoney(totals.grand)} incl VAT${totals.monthly != null ? ` + ${fmtMoney(totals.monthly)} / month` : ""}.
            You can review it, print it, and accept or decline online.
          </p>
          <p style="margin:20px 0 0;">
            <a href="${url}" style="background:#D7141C; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">View the quote</a>
          </p>
          <p style="margin:24px 0 0; color:#888; font-size:12.5px;">— Rocky</p>
        </div>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: '"Rocky @ Rocking" <quotes@send.rocking.one>',
      to, cc: ["shawn@rocking.one"], subject: `${heading}: ${title}`,
      html: clientHtml,
    }),
  });
  console.log(res.ok ? `Emailed ${to.join(", ")}` : `EMAIL FAILED (${res.status}) — quote still created`);
  if (res.ok) {
    const sent = await res.json();
    if (sent?.id) {
      await sb.from("quote_events")
        .update({ resend_message_id: `<${sent.id}@send.rocking.one>` })
        .eq("quote_id", quoteId).eq("version", version).eq("event", "sent");
    }
    // Record it for /communications and the admin activity feed (best-effort).
    // Mirrors lib/email/send.ts — this script can't import the TS helper, so
    // the two write paths must be kept in sync by hand.
    await sb.from("sent_emails").insert({
      client_id: clientId,
      to_emails: [...to, "shawn@rocking.one"],
      subject: `${heading}: ${title}`,
      html: clientHtml,
      category: "quote",
      audience: "client",
    }).then(({ error }) => { if (error) console.error("sent_emails log failed:", error.message); });
  }
} else {
  console.log("No manager emails sent", to.length ? "(no RESEND_API_KEY)" : "(client has no active managers)");
}

console.log(`${amendId ? "Amended" : "Created"} ${quoteNumber} v${version} — ${fmtMoney(totals.grand)} incl VAT${totals.monthly != null ? ` + ${fmtMoney(totals.monthly)}/mo` : ""}`);
console.log(`Manager view: ${url}`);
console.log(`Admin view:   ${APP_URL}/admin/quotes/${quoteId}`);
