// Connect a client's M365 tenant: device-code sign-in (once, as their admin),
// then store the encrypted refresh token in m365_connections.
//
//   node scripts/m365-connect.mjs <clientId>

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { deviceLogin, graphAll, encryptSecret } from "../lib/m365-graph.mjs";

const clientId = process.argv[2];
if (!clientId) {
  console.error("Usage: node scripts/m365-connect.mjs <clientId>");
  process.exit(1);
}

const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const encKey = env.M365_TOKEN_ENC_KEY;
if (!encKey) throw new Error("M365_TOKEN_ENC_KEY missing from .env.local");

const { data: client } = await sb.from("clients").select("id, name").eq("id", clientId).maybeSingle();
if (!client) throw new Error(`client ${clientId} not found`);
console.log(`Connecting M365 for client: ${client.name}`);

const tok = await deviceLogin(({ uri, code }) => {
  console.log("\n┌─────────────────────────────────────────────");
  console.log("│  Open:  " + uri);
  console.log("│  Code:  " + code);
  console.log(`│  Sign in as ${client.name}'s M365 admin.`);
  console.log("└─────────────────────────────────────────────\n");
});
if (!tok.refresh_token) throw new Error("no refresh token returned");

const org = await graphAll(tok.access_token, "/organization?$select=id,displayName");
const tenantId = org[0]?.id ?? null;
const tenantName = org[0]?.displayName ?? null;

const enc = encryptSecret(tok.refresh_token, encKey);
const { error } = await sb.from("m365_connections").upsert(
  {
    client_id: clientId,
    tenant_id: tenantId,
    tenant_name: tenantName,
    token_ciphertext: enc.ciphertext,
    token_iv: enc.iv,
    token_tag: enc.tag,
    status: "connected",
  },
  { onConflict: "client_id" },
);
if (error) throw error;

console.log(`✓ Connected ${tenantName} (tenant ${tenantId}). Run m365-pull.mjs ${clientId} to ingest.`);
