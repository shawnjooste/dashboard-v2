// Datto RMM REST API helper (CLI-shared, plain ESM). Auth via account API
// key+secret -> client-credentials token. No per-tenant connect: one account
// covers all sites.

import { readFileSync } from "node:fs";

export function dattoEnv() {
  const env = {};
  for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.DATTO_RMM_URL || !env.DATTO_RMM_KEY || !env.DATTO_RMM_SECRET) {
    throw new Error("DATTO_RMM_URL/KEY/SECRET missing from .env.local");
  }
  return env;
}

export async function getToken(env) {
  const r = await fetch(`${env.DATTO_RMM_URL}/auth/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from("public-client:public").toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=password&username=${encodeURIComponent(env.DATTO_RMM_KEY)}&password=${encodeURIComponent(env.DATTO_RMM_SECRET)}`,
  });
  const body = await r.json();
  if (!body.access_token) throw new Error("Datto auth failed: " + JSON.stringify(body));
  return body.access_token;
}

export async function dattoGet(env, token, path) {
  const r = await fetch(`${env.DATTO_RMM_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
}

/** GET a paginated collection, following pageDetails.nextPageUrl. */
export async function dattoPaged(env, token, path, key) {
  let url = `${env.DATTO_RMM_URL}${path}`;
  const out = [];
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const body = await r.json();
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status} ${JSON.stringify(body).slice(0, 120)}`);
    out.push(...(body[key] ?? []));
    url = body.pageDetails?.nextPageUrl ?? null;
  }
  return out;
}

export const epochToIso = (ms) =>
  ms && Number.isFinite(Number(ms)) ? new Date(Number(ms)).toISOString() : null;
