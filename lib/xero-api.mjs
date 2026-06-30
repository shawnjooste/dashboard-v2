// Xero Accounting API client (read-only). Reuses the AES-GCM token crypto from
// the M365 integration. No per-call retry beyond token refresh.
import { readFileSync } from "node:fs";
export { encryptSecret, decryptSecret } from "./m365-graph.mjs";

const TOKEN_URL = "https://identity.xero.com/connect/token";
const API = "https://api.xero.com/api.xro/2.0";

export function xeroEnv() {
  const env = {};
  for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  for (const k of ["XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "XERO_REDIRECT_URI", "XERO_TOKEN_ENC_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if (!env[k]) throw new Error(`${k} missing from .env.local`);
  }
  return env;
}

function basicAuth(env) {
  return "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64");
}

async function tokenRequest(env, body) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(env), "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    const err = new Error(`Xero token error: ${j.error ?? r.status}`);
    if (j.error === "invalid_grant") err.code = "invalid_grant";
    throw err;
  }
  return j;
}

export const exchangeCode = (env, code) =>
  tokenRequest(env, new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: env.XERO_REDIRECT_URI }));

export const refreshToken = (env, refresh_token) =>
  tokenRequest(env, new URLSearchParams({ grant_type: "refresh_token", refresh_token }));

export async function getTenants(accessToken) {
  const r = await fetch("https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } });
  return r.json();
}

export async function xeroGet(accessToken, tenantId, path) {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": tenantId, Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`Xero GET ${path}: HTTP ${r.status}`);
  return r.json();
}
