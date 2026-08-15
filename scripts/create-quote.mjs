// Creates (or amends) a quote from a JSON file, on the quote service
// (lib/quotes/service.ts) — the one place that creates/sends/amends a quote.
// create()/amend() never email a client and never produce status 'sent';
// only send() does. So this script is two calls where it used to be one:
//
//   node scripts/create-quote.mjs quote.json                     # create, then send: status sent
//   node scripts/create-quote.mjs quote.json --amend <quoteId>   # amend, then send: new version, status sent
//   ... --no-email                                      # create/amend only, don't send — the quote
//                                                        #   lands in draft (not sent, as it used to).
//                                                        #   Review it, then send separately (e.g.
//                                                        #   from the admin quote page).
//   ... --checkout                                       # checkout-enabled: client PAYS the quote
//                                                        #   (Paystack card checkout; once-off +
//                                                        #   pro-rata now, monthly billed on the 1st)
//                                                        #   instead of clicking Accept
//   ... --billing-next-month                             # no pro-rata: collect the once-off at
//                                                        #   checkout (or a refunded R1 if there is
//                                                        #   none); monthly billing starts on the 1st
//   ... --pending-review                                # status pending_review; never sent to the
//                                                        #   client. The service itself emails
//                                                        #   shawn@/kelle@rocking.one to review and
//                                                        #   approve — for quotes built without a
//                                                        #   human already reviewing them (e.g. the
//                                                        #   automated inbound-email pipeline).
//                                                        #   Combining with --no-email changes
//                                                        #   nothing further: pending-review never
//                                                        #   sends to the client either way.
//                                                        #   Approve-and-send happens from the admin
//                                                        #   quote page.
//
// Input file:
// {
//   "clientId": "..."            // or "clientName": "GSR Law"
//   "title": "VoIP Phone System",
//   "validUntil": "2026-07-11",  // ISO date for expiry derivation
//   "doc": { ...QuoteDoc shape (lib/quotes/doc.ts); meta.quoteNumber is filled in here },
//   "internal": [{ "path": "s0.g0.i0", "supplierCost": 850, "note": "Miro invoice #123" }]
//   // supplierCost convention: ex-VAT LINE TOTAL (incl-VAT cost / 1.15 × qty)
// }
//
// Quote numbers are always allocated by the service from the client's
// quote_prefix — an input "number" field (previously used to keep an
// existing number for an imported historical quote) is no longer accepted;
// the script refuses rather than silently ignoring it. A client with no
// quote_prefix set is refused too, by the service.

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { computeTotals } from "../lib/quotes/doc.ts";
import { makeQuoteService } from "../lib/quotes/service.ts";

// ---------- env ----------
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";
const svc = makeQuoteService(sb);

const fmtMoney = (n) =>
  "R " + Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- args ----------
const [file, ...rest] = process.argv.slice(2);
if (!file) { console.error("usage: node scripts/create-quote.mjs <quote.json> [--amend <quoteId>]"); process.exit(1); }
const amendIdx = rest.indexOf("--amend");
const amendId = amendIdx !== -1 ? rest[amendIdx + 1] : null;
const noEmail = rest.includes("--no-email");
const pendingReview = rest.includes("--pending-review");
const checkoutEnabled = rest.includes("--checkout");
// Client is paid up for the current month: checkout captures the card via a
// refunded R1 verification and billing starts on the 1st of next month.
const billingNextMonth = rest.includes("--billing-next-month");
const input = JSON.parse(readFileSync(file, "utf8"));
const { doc, internal = [], title, validUntil } = input;
if (!doc || !title) { console.error("input needs { title, doc }"); process.exit(1); }
if (input.number) {
  console.error(
    `refusing: input "number" (${input.number}) is no longer accepted.\n` +
      `Quote numbers are always allocated by the service from the client's quote_prefix — remove the "number" field from ${file} and re-run.\n` +
      `(If the client has no quote_prefix set, the service will refuse the create too — set one before retrying.)`
  );
  process.exit(1);
}

// canSend: false under --pending-review routes the quote into pending_review
// and skips sending entirely, whether or not --no-email is also passed.
const actor = { id: null, label: "create-quote.mjs", canSend: !pendingReview };

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

let quoteId, quoteNumber, version, status, replayed = false;

if (amendId) {
  // ---------- new version of an existing quote ----------
  const { data: q, error } = await sb.from("quotes").select("quote_number").eq("id", amendId).single();
  if (error || !q) { console.error("quote not found:", amendId); process.exit(1); }
  quoteId = amendId;
  quoteNumber = q.quote_number;
  doc.meta.quoteNumber = quoteNumber; // amend() stores doc as-is; it doesn't stamp the number itself

  const res = await svc.amend(amendId, { title, doc, validUntil, internal }, actor);
  if (!res.ok) { console.error(res.error); process.exit(1); }
  version = res.version;
  status = res.status;

  // amend() doesn't carry checkout/billing columns (they're create-time
  // concepts on this quote row, deliberately absent from AmendQuoteInput);
  // set them directly here when asked. This second write is therefore not
  // atomic with svc.amend() above — a crash or interrupt between the two
  // could leave the amend applied without the column update. A reviewer
  // confirmed there is no clobbering race with concurrent writers (this
  // update only ever sets these two columns to true, never reads-then-writes
  // other quote state), so the risk is a missed flag on failure, not
  // corruption — worth knowing, not worth engineering away here.
  if (checkoutEnabled || billingNextMonth) {
    const { error: colErr } = await sb.from("quotes").update({
      ...(checkoutEnabled ? { checkout_enabled: true } : {}),
      ...(billingNextMonth ? { billing_starts_next_month: true } : {}),
    }).eq("id", quoteId);
    if (colErr) throw colErr;
  }
} else {
  // ---------- brand-new quote ----------
  const res = await svc.create({
    clientId, title, doc, validUntil, internal,
    checkoutEnabled, billingStartsNextMonth: billingNextMonth,
    idempotencyKey: process.env.QUOTE_IDEMPOTENCY_KEY ?? null,
  }, actor);
  if (!res.ok) { console.error(res.error); process.exit(1); }
  quoteId = res.quoteId;
  quoteNumber = res.quoteNumber;
  version = res.version;
  status = res.status;
  replayed = res.replayed;
}

// ---------- send (or don't) ----------
if (replayed) {
  console.log(`Idempotent replay — an earlier run already wrote this quote, status: ${status}`);
} else if (pendingReview) {
  console.log(`Pending review — the service notified shawn@/kelle@rocking.one — status: ${status}`);
} else if (noEmail) {
  console.log(`Email skipped (--no-email) — status: ${status}`);
} else {
  const sendRes = await svc.send(quoteId, actor);
  if (!sendRes.ok) {
    console.error("EMAIL FAILED — quote still created:", sendRes.error);
  } else if (sendRes.sentTo.length) {
    console.log(`Emailed ${sendRes.sentTo.join(", ")}`);
  } else {
    console.log("Sent, but every recipient was suppressed — nobody actually received it");
  }
}

const totals = computeTotals(doc);
const url = `${APP_URL}/quotes/${quoteId}`;
console.log(`${amendId ? "Amended" : "Created"} ${quoteNumber} v${version} — ${fmtMoney(totals.grand)} incl VAT${totals.monthly != null ? ` + ${fmtMoney(totals.monthly)}/mo` : ""}`);
if (checkoutEnabled) console.log("Checkout: ENABLED (client pays instead of accepting)");
if (billingNextMonth) console.log("Billing: no pro-rata — once-off collected at checkout (or a refunded R1 if there is none); monthly starts on the 1st");
console.log(`Manager view: ${url}`);
console.log(`Admin view:   ${APP_URL}/admin/quotes/${quoteId}`);
