// Seed client_domains (and create clients) from the customer→domain CSV.
// Conservative + security-aware: drops shared/service/junk domains, and for
// multi-domain customers prefers the domain that matches the customer name
// (the rest are usually counterparties extracted from email, not their own).
//
// Usage:
//   node scripts/seed-client-domains.mjs <csv-path>            # DRY RUN (prints plan)
//   node scripts/seed-client-domains.mjs <csv-path> --apply    # writes to DB
//
// Only customers that end up with >=1 safe domain are created.

import { readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";

const csvPath = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!csvPath) {
  console.error("Usage: node scripts/seed-client-domains.mjs <csv-path> [--apply]");
  process.exit(1);
}

function loadEnv() {
  const txt = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env = {};
  for (const line of txt.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// CSV customer name -> existing client name (avoid duplicating Datto clients)
const NAME_MAP = { "Interland Group": "Interland" };
// Domains that are real but shared across rows — force-assign to one client.
const FORCE = { "interlandgroup.co.za": "Interland" };

// shared/service/free/ISP/malformed domains that must never be a self-reg key
const BLOCK = new Set([
  "teams.microsoft.com", "mysignins.microsoft.com", "portal.office.com",
  "in.xero.com", "post.xero.com", "reader.striata.com", "merlot.rmm.datto.com",
  "godaddy.com", "takealot.com", "downdetector.co.za", "registry.net.za",
  "yahoo.de", "yahoo.com", "gmail.com", "hotmail.com", "outlook.com", "iafrica.com",
  "sars.gov.za", "unifi.rocking.co.za", "roking.co.za", "rockingconnect.pdf",
  "saca.org.zapassword", "four-paws.org", "expand.agency", "pmssp.cloud",
  "dpogroup.com", "paygate.co.za", "auscricket.com.au", "jumpstarthr.com.au",
  "theworldca.com", "wca.com", "capital-sa.com", "law.co.za",
  // vendor/service/counterparty domains caught in review
  "evetech.co.za", "xneelo.com", "itnsecurity.co.za", "securicom.co.za", "rws.com",
]);

const STOP = new Set(
  "the,and,group,holdings,pty,ltd,inc,cc,sa,co,za,com,net,org,law,consulting,solutions,technology,technologies,investments,investment,capital,financial,planning,services,service,trading,properties,property,recruitment,international,int,connect,africa,cape,south,company".split(","),
);
const nameTokens = (name) =>
  name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((t) => t && !STOP.has(t) && t.length >= 3);
const sld = (domain) => {
  const p = domain.split(".");
  const n = p.length;
  if (["co", "org", "com", "net", "gov", "ac"].includes(p[n - 2]) && n >= 3) return p[n - 3];
  return p[n - 2];
};
const matchesName = (name, domain) => {
  const s = sld(domain);
  if (!s) return false;
  for (const t of nameTokens(name)) if (s.includes(t) || t.includes(s)) return true;
  return false;
};
const malformed = (d) => !d.includes(".") || d.includes(" ") || d.endsWith(".pdf");

// ---- parse + compute shared domains ----
const rows = parse(readFileSync(csvPath, "utf8"), { columns: false, skip_empty_lines: true }).slice(1);
const cust = [];
for (const r of rows) {
  const name = (r[0] || "").trim();
  if (!name || name === "Customers" || name.startsWith("~")) continue;
  const raw = (r[1] || "").trim();
  const doms = raw && !raw.startsWith("(none") ? raw.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean) : [];
  cust.push({ name, doms });
}
const dom2cust = new Map();
for (const { name, doms } of cust)
  for (const d of doms) (dom2cust.get(d) ?? dom2cust.set(d, []).get(d)).push(name);
const shared = new Set([...dom2cust].filter(([, cs]) => cs.length > 1).map(([d]) => d));

// ---- build plan: customer -> kept domains ----
const plan = []; // { name, clientName, domains: [] }
for (const { name, doms } of cust) {
  const clean = doms.filter((d) => !BLOCK.has(d) && !shared.has(d) && !malformed(d));
  if (clean.length === 0) continue;
  const matched = clean.filter((d) => matchesName(name, d));
  const keep = matched.length ? matched : clean;
  plan.push({ name, clientName: NAME_MAP[name] ?? name, domains: keep });
}
// force-assigned shared domains
for (const [d, target] of Object.entries(FORCE)) {
  let p = plan.find((x) => x.clientName === target);
  if (!p) { p = { name: target, clientName: target, domains: [] }; plan.push(p); }
  if (!p.domains.includes(d)) p.domains.push(d);
}

const totalDomains = plan.reduce((n, p) => n + p.domains.length, 0);
console.log(`Plan: ${plan.length} clients, ${totalDomains} domains (${APPLY ? "APPLYING" : "DRY RUN"})\n`);
for (const p of plan.sort((a, b) => a.clientName.localeCompare(b.clientName)))
  console.log(`  ${p.clientName.padEnd(34)} ${p.domains.join(", ")}`);

if (!APPLY) {
  console.log("\n(dry run — re-run with --apply to write)");
  process.exit(0);
}

// ---- apply ----
const { data: existing } = await supabase.from("clients").select("id, name");
const byName = new Map((existing ?? []).map((c) => [c.name, c.id]));
let created = 0, domainsAdded = 0;
for (const p of plan) {
  let clientId = byName.get(p.clientName);
  if (!clientId) {
    const { data, error } = await supabase.from("clients").insert({ name: p.clientName }).select("id").single();
    if (error) throw error;
    clientId = data.id;
    byName.set(p.clientName, clientId);
    created++;
  }
  for (const d of p.domains) {
    const { error } = await supabase
      .from("client_domains")
      .upsert({ domain: d, client_id: clientId }, { onConflict: "domain", ignoreDuplicates: true });
    if (!error) domainsAdded++;
  }
}
console.log(`\nApplied: ${created} clients created, ${domainsAdded} domain rows upserted.`);
