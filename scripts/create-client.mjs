// Creates a brand-new client (tenant) in the portal — for prospects who don't
// exist anywhere else yet, so a quote can be created for them.
//
//   node scripts/create-client.mjs "Acme Corp"
//   node scripts/create-client.mjs "Acme Corp" --domain acme.co.za
//   node scripts/create-client.mjs "Acme Corp" --domain acme.co.za --manager jane@acme.co.za --manager bob@acme.co.za
//
// --domain registers a self-registration domain (client_domains): anyone who
//   later signs up with that email domain auto-joins this client as an
//   active client_member. Optional — skip for prospects whose domain you
//   don't want to open up yet.
//
// --manager creates (or claims an existing) auth user for that email and
//   sets their profile to client_manager/active on this client, so they can
//   be sent a quote immediately. Repeatable.
//
// Prints the new clientId — pass it as "clientId" in a quote JSON for
// scripts/create-quote.mjs.

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const args = process.argv.slice(2);
const name = args[0];
if (!name || name.startsWith("--")) {
  console.error("usage: node scripts/create-client.mjs <name> [--domain example.com] [--manager email ...]");
  process.exit(1);
}
const domainIdx = args.indexOf("--domain");
const domain = domainIdx !== -1 ? args[domainIdx + 1].toLowerCase() : null;
const managers = args.flatMap((a, i) => (a === "--manager" ? [args[i + 1]] : [])).filter(Boolean);

// ---------- guard against duplicates ----------
const { data: existing } = await sb.from("clients").select("id, name").ilike("name", name);
if (existing?.length) {
  console.error(`A client already matches "${name}": ${existing.map((c) => `${c.name} (${c.id})`).join(", ")}`);
  process.exit(1);
}

// ---------- create client ----------
const { data: client, error: cErr } = await sb.from("clients").insert({ name }).select("id, name").single();
if (cErr) { console.error("failed to create client:", cErr.message); process.exit(1); }
console.log(`Client:   ${client.name}`);
console.log(`Client ID: ${client.id}`);

// ---------- optional self-registration domain ----------
if (domain) {
  const { error } = await sb.from("client_domains").insert({ domain, client_id: client.id });
  if (error) console.error(`domain "${domain}" not added:`, error.message);
  else console.log(`Domain:   ${domain} → auto-joins as active client_member`);
}

// ---------- optional manager invites ----------
for (const email of managers) {
  const clean = email.trim().toLowerCase();

  // Claim an existing profile (e.g. they already signed up under 'pending') if present.
  const { data: existingProfile } = await sb.from("profiles").select("id").ilike("email", clean).maybeSingle();

  let profileId = existingProfile?.id ?? null;
  if (!profileId) {
    const { data: created, error: uErr } = await sb.auth.admin.createUser({ email: clean, email_confirm: true });
    if (uErr) { console.error(`manager "${clean}" not created:`, uErr.message); continue; }
    profileId = created.user.id;
  }

  const { error: pErr } = await sb
    .from("profiles")
    .update({ client_id: client.id, role: "client_manager", status: "active" })
    .eq("id", profileId);
  if (pErr) console.error(`manager "${clean}" not linked:`, pErr.message);
  else console.log(`Manager:  ${clean} → active client_manager`);
}

console.log(`\nNext: create a quote with "clientId": "${client.id}" via scripts/create-quote.mjs`);
