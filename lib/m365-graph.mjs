// Shared infra for the M365 CLIs (connect/pull). Plain ESM so the .mjs scripts
// can import it. Device-code auth via Microsoft's first-party Graph CLI app
// (no Azure app registration), Graph fetch helpers, and AES-256-GCM crypto for
// the stored refresh token. The web app never imports this.

import crypto from "node:crypto";

export const CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"; // Microsoft Graph CLI
const AUTH = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
export const GRAPH = "https://graph.microsoft.com/v1.0";
export const SCOPES = [
  "User.Read.All", "Group.Read.All", "Organization.Read.All", "Directory.Read.All",
  "Policy.Read.All", "UserAuthenticationMethod.Read.All", "Device.Read.All",
  "Reports.Read.All", "AuditLog.Read.All", "SecurityEvents.Read.All", "offline_access",
].join(" ");

const form = (o) => new URLSearchParams(o).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tokenPost = (body) =>
  fetch(`${AUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form(body),
  }).then((r) => r.json());

/** Interactive device-code sign-in. Calls onCode({ uri, code }) to display. */
export async function deviceLogin(onCode) {
  const dc = await fetch(`${AUTH}/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: CLIENT_ID, scope: SCOPES }),
  }).then((r) => r.json());
  if (!dc.device_code) throw new Error("devicecode failed: " + JSON.stringify(dc));
  onCode({ uri: dc.verification_uri, code: dc.user_code });

  const deadline = Date.now() + dc.expires_in * 1000;
  let interval = (dc.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const r = await tokenPost({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: CLIENT_ID,
      device_code: dc.device_code,
    });
    if (r.access_token) return r; // includes refresh_token
    if (r.error === "authorization_pending") continue;
    if (r.error === "slow_down") { interval += 5000; continue; }
    throw new Error("token error: " + (r.error_description || r.error));
  }
  throw new Error("device code expired before sign-in");
}

/** Exchange a refresh token for a fresh access token (headless). */
export async function refreshAccessToken(refreshToken) {
  const r = await tokenPost({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
    scope: SCOPES,
  });
  if (!r.access_token) {
    const err = new Error("refresh failed: " + (r.error_description || r.error || "unknown"));
    err.code = r.error;
    throw err;
  }
  return r; // { access_token, refresh_token }
}

/** GET a Graph path; returns { ok, status, body }. */
export async function graphGet(accessToken, path, headers = {}) {
  const r = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, ...headers },
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

/** GET and follow @odata.nextLink, collecting .value across pages. */
export async function graphAll(accessToken, path) {
  let url = `${GRAPH}${path}`;
  const out = [];
  while (url) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = await r.json();
    if (body.error) throw new Error(`${path}: ${body.error.message}`);
    out.push(...(body.value ?? []));
    url = body["@odata.nextLink"] ?? null;
  }
  return out;
}

// ── AES-256-GCM crypto for the stored refresh token ──────────────────────────
const keyBuf = (keyBase64) => {
  const k = Buffer.from(keyBase64, "base64");
  if (k.length !== 32) throw new Error("M365_TOKEN_ENC_KEY must be 32 bytes (base64)");
  return k;
};

export function encryptSecret(plaintext, keyBase64) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf(keyBase64), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret({ ciphertext, iv, tag }, keyBase64) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBuf(keyBase64), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
