// One-time Xero OAuth sign-in. Opens a local callback server, prints the
// authorize URL, captures the redirect code, stores the encrypted refresh
// token + tenant in xero_connection.  node scripts/xero-connect.mjs
import { createServer } from "node:http";
import { createClient } from "@supabase/supabase-js";
import { xeroEnv, exchangeCode, getTenants, encryptSecret } from "../lib/xero-api.mjs";

const env = xeroEnv();
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const port = Number(new URL(env.XERO_REDIRECT_URI).port || 8737);
const scope = "offline_access accounting.transactions.read accounting.contacts.read";
const authUrl = `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${env.XERO_CLIENT_ID}&redirect_uri=${encodeURIComponent(env.XERO_REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&state=portal`;

console.log("\n┌──────────────────────────────────────────────");
console.log("│  Open this URL and sign in as Rocking's Xero admin:");
console.log("│  " + authUrl);
console.log("└──────────────────────────────────────────────\n");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, env.XERO_REDIRECT_URI);
  if (!url.pathname.startsWith("/callback")) { res.writeHead(404).end(); return; }
  const code = url.searchParams.get("code");
  try {
    const tok = await exchangeCode(env, code);
    const tenants = await getTenants(tok.access_token);
    const t = tenants[0];
    const enc = encryptSecret(tok.refresh_token, env.XERO_TOKEN_ENC_KEY);
    await sb.from("xero_connection").upsert({
      id: 1, tenant_id: t.tenantId, tenant_name: t.tenantName,
      token_ciphertext: enc.ciphertext, token_iv: enc.iv, token_tag: enc.tag,
      status: "connected", updated_at: new Date().toISOString(),
    });
    res.writeHead(200, { "Content-Type": "text/html" }).end("<h2>Xero connected. You can close this tab.</h2>");
    console.log(`✓ Connected Xero org "${t.tenantName}" (${t.tenantId}). Run xero-map then xero-pull.`);
  } catch (e) {
    res.writeHead(500).end("error: " + e.message);
    console.error("connect failed:", e.message);
  } finally {
    server.close();
  }
});
server.listen(port, () => console.log(`Waiting for Xero redirect on ${env.XERO_REDIRECT_URI} …`));
