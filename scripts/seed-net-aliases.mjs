// Seed network_source_aliases for the GSR pilot. Idempotent (upsert on source+key).
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: gsr } = await sb.from("clients").select("id, name").ilike("name", "%gsr%");
if (!gsr || gsr.length !== 1) { console.log("expected exactly one GSR client, got:", JSON.stringify(gsr)); process.exit(1); }
const clientId = gsr[0].id;
console.log(`GSR client: ${gsr[0].name} (${clientId})`);

const aliases = [
  { source: "meraki", source_key: "614741349136072776/L_643451796760566041", client_id: clientId, label: "GSRLaw" },
  { source: "unifi_selfhosted", source_key: "pckw6iu6", client_id: clientId, label: "Gunstons" },
];
const { error } = await sb.from("network_source_aliases").upsert(aliases, { onConflict: "source,source_key" });
if (error) { console.log("ERR:", error.message); process.exit(1); }
const { data } = await sb.from("network_source_aliases").select("source, source_key, label, client_id");
console.log("aliases now:", JSON.stringify(data, null, 1));
