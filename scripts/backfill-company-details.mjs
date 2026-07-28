// Seeds client_company_details from the mapped Xero contact.
//
//   node scripts/backfill-company-details.mjs --dry   # show what would change
//   node scripts/backfill-company-details.mjs         # write it
//
// Fill-only: writes a field ONLY when the target is currently blank, so it
// never overwrites a correction a manager has made, and is safe to re-run.
// Deliberately silent: writes no company_detail_changes rows and sends no
// email. A seed is not a human edit — logging it would fire an email per
// client and fill every audit log with "system changed everything".
import { createClient } from "@supabase/supabase-js";
import { xeroEnv, refreshToken, xeroGet, decryptSecret, encryptSecret } from "../lib/xero-api.mjs";

const DRY = process.argv.includes("--dry");

const env = xeroEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: conn } = await sb.from("xero_connection").select("*").eq("id", 1).single();
const refreshed = await refreshToken(
  env,
  decryptSecret({ ciphertext: conn.token_ciphertext, iv: conn.token_iv, tag: conn.token_tag }, env.XERO_TOKEN_ENC_KEY),
);
const renc = encryptSecret(refreshed.refresh_token, env.XERO_TOKEN_ENC_KEY);
const { error: tokenPersistErr } = await sb
  .from("xero_connection")
  .update({ token_ciphertext: renc.ciphertext, token_iv: renc.iv, token_tag: renc.tag })
  .eq("id", 1);
if (tokenPersistErr) {
  console.error(
    `WARNING: refreshed the Xero token but failed to persist it (${tokenPersistErr.message}). ` +
      `Xero rotates the refresh token on every use, so the database now holds a DEAD token — the ` +
      `next refresh will fail here and in the live app until someone manually reauthorises.`,
  );
}
const tok = refreshed.access_token;
const tid = conn.tenant_id;

const { data: clients } = await sb
  .from("clients")
  .select("id, name, xero_contact_id")
  .not("xero_contact_id", "is", null);
const byContact = new Map(clients.map((c) => [c.xero_contact_id, c]));
console.log(`Mapped clients: ${clients.length}${DRY ? "  (DRY RUN)" : ""}`);

// Page the whole contact list; the IDs= filter 404s on long URLs.
const contacts = new Map();
for (let page = 1; page <= 20; page++) {
  const res = await xeroGet(tok, tid, `/Contacts?page=${page}`);
  const batch = res.Contacts ?? [];
  if (!batch.length) break;
  for (const x of batch) if (byContact.has(x.ContactID)) contacts.set(x.ContactID, x);
}

const addr = (x, type) => (x.Addresses ?? []).find((a) => a.AddressType === type) ?? null;
const lines = (a) => (a ? [a.AddressLine1, a.AddressLine2, a.AddressLine3, a.AddressLine4].filter(Boolean).join("\n") || null : null);
const sameAddress = (a, b) =>
  !!a && !!b &&
  lines(a) === lines(b) &&
  (a.City ?? null) === (b.City ?? null) &&
  (a.PostalCode ?? null) === (b.PostalCode ?? null);

const phone = (x) => {
  const p = (x.Phones ?? []).find((v) => v.PhoneNumber);
  if (!p) return null;
  return [p.PhoneCountryCode, p.PhoneAreaCode, p.PhoneNumber].filter(Boolean).join(" ").trim() || null;
};

function fromXero(x) {
  const street = addr(x, "STREET");
  const pobox = addr(x, "POBOX");
  // STREET and POBOX are byte-identical for ~84% of contacts. Copying both
  // would print the same address twice on most clients' pages.
  const physical = street && (street.AddressLine1 || street.City) ? street : pobox;
  const postal = sameAddress(street, pobox) ? null : pobox === physical ? null : pobox;

  return {
    registered_name: x.Name || null,
    vat_number: x.TaxNumber || null,
    registration_number: x.CompanyNumber || null,
    physical_address: lines(physical),
    physical_city: physical?.City || null,
    physical_postal_code: physical?.PostalCode || null,
    postal_address: lines(postal),
    postal_city: postal?.City || null,
    postal_postal_code: postal?.PostalCode || null,
    billing_contact_name: [x.FirstName, x.LastName].filter(Boolean).join(" ") || null,
    billing_contact_email: x.EmailAddress || null,
    billing_contact_phone: phone(x),
  };
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

let written = 0, untouched = 0;
const missing = [];

for (const client of clients) {
  const x = contacts.get(client.xero_contact_id);
  if (!x) {
    missing.push(client.name);
    continue;
  }

  const { data: existing, error: existingErr } = await sb
    .from("client_company_details")
    .select("*")
    .eq("client_id", client.id)
    .maybeSingle();
  if (existingErr) {
    console.warn(`  ! ${client.name}: could not read existing row (${existingErr.message}) — skipping, not overwriting`);
    continue;
  }

  const candidate = fromXero(x);
  const patch = {};
  for (const [field, value] of Object.entries(candidate)) {
    if (isBlank(value)) continue;
    if (existing && !isBlank(existing[field])) continue; // never overwrite
    patch[field] = value;
  }

  if (!Object.keys(patch).length) {
    untouched++;
    continue;
  }

  console.log(`${DRY ? "would fill" : "filling  "} ${client.name.padEnd(34)} ${Object.keys(patch).join(", ")}`);
  if (!DRY) {
    const { error } = await sb
      .from("client_company_details")
      .upsert({ client_id: client.id, ...patch }, { onConflict: "client_id" });
    if (error) {
      console.error(`  ✗ ${client.name}: ${error.message}`);
      continue;
    }
  }
  written++;
}

console.log(`\n${DRY ? "Would write" : "Wrote"}: ${written}   already populated: ${untouched}`);
if (missing.length) {
  console.log(`Not found in Xero (${missing.length}) — likely archived there:`);
  for (const n of missing) console.log(`  · ${n}`);
}
