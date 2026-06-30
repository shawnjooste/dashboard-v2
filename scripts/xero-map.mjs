// Map a Portal client to a Xero Contact by name.
//   node scripts/xero-map.mjs <clientId> "GSR Law"
import { createClient } from "@supabase/supabase-js";
import { xeroEnv, refreshToken, xeroGet, decryptSecret, encryptSecret } from "../lib/xero-api.mjs";

const [clientId, contactName] = process.argv.slice(2);
if (!clientId || !contactName) { console.error('Usage: node scripts/xero-map.mjs <clientId> "<Contact Name>"'); process.exit(1); }

const env = xeroEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connection").select("*").eq("id", 1).single();
const refreshed = await refreshToken(env, decryptSecret({ ciphertext: conn.token_ciphertext, iv: conn.token_iv, tag: conn.token_tag }, env.XERO_TOKEN_ENC_KEY));
const renc = encryptSecret(refreshed.refresh_token, env.XERO_TOKEN_ENC_KEY);
await sb.from("xero_connection").update({ token_ciphertext: renc.ciphertext, token_iv: renc.iv, token_tag: renc.tag }).eq("id", 1);

const res = await xeroGet(refreshed.access_token, conn.tenant_id, `/Contacts?where=${encodeURIComponent(`Name=="${contactName}"`)}`);
const contact = (res.Contacts ?? [])[0];
if (!contact) { console.error(`No Xero contact named "${contactName}". Check the exact name in Xero.`); process.exit(1); }
await sb.from("clients").update({ xero_contact_id: contact.ContactID }).eq("id", clientId);
console.log(`✓ Mapped client ${clientId} -> Xero contact "${contact.Name}" (${contact.ContactID}). Run: node scripts/xero-pull.mjs ${clientId}`);
