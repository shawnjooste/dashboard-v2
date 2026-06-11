// M365 capability probe — enumerates what Graph gives us for a tenant using
// the first-party Graph CLI app + device code (no Azure app registration).
// Saves the refresh token to .m365-token.json (gitignored) for headless reuse.
//
//   node scripts/m365-explore.mjs           # reuse saved token, else device-code
//   node scripts/m365-explore.mjs --login   # force a fresh device-code sign-in

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e"; // Microsoft Graph CLI
const BASE = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const TOKEN_FILE = new URL("../.m365-token.json", import.meta.url);
const SCOPES = [
  "User.Read.All", "Group.Read.All", "Organization.Read.All", "Directory.Read.All",
  "Policy.Read.All", "UserAuthenticationMethod.Read.All", "Device.Read.All",
  "DeviceManagementManagedDevices.Read.All", "Reports.Read.All", "AuditLog.Read.All",
  "SecurityEvents.Read.All", "offline_access",
].join(" ");

const form = (o) => new URLSearchParams(o).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (body) =>
  fetch(`${BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form(body),
  }).then((r) => r.json());

async function deviceLogin() {
  const dc = await fetch(`${BASE}/devicecode`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ client_id: CLIENT_ID, scope: SCOPES }),
  }).then((r) => r.json());
  console.log("\n┌─────────────────────────────────────────────");
  console.log("│  Open:  " + dc.verification_uri);
  console.log("│  Code:  " + dc.user_code);
  console.log("│  Sign in as the CLIENT's M365 admin account.");
  console.log("└─────────────────────────────────────────────\n");
  const deadline = Date.now() + dc.expires_in * 1000;
  let interval = (dc.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const r = await post({
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: CLIENT_ID,
      device_code: dc.device_code,
    });
    if (r.access_token) return r;
    if (r.error === "authorization_pending") continue;
    if (r.error === "slow_down") { interval += 5000; continue; }
    throw new Error(r.error_description || r.error);
  }
  throw new Error("device code expired");
}

async function getToken(forceLogin) {
  if (!forceLogin && existsSync(TOKEN_FILE)) {
    const saved = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
    const r = await post({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: saved.refresh_token,
      scope: SCOPES,
    });
    if (r.access_token) {
      writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: r.refresh_token }, null, 2));
      console.log("✓ reused saved token (headless).");
      return r.access_token;
    }
    console.log("saved token invalid, falling back to device login…");
  }
  const r = await deviceLogin();
  writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: r.refresh_token }, null, 2));
  console.log("✓ signed in; refresh token saved to .m365-token.json");
  return r.access_token;
}

let AT;
async function g(path, headers = {}) {
  const r = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${AT}`, ...headers },
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, body };
}

/** Probe one endpoint; report availability + a count/sample. */
async function probe(label, path, { count = false } = {}) {
  const headers = count ? { ConsistencyLevel: "eventual" } : {};
  const p = count ? `${path}${path.includes("?") ? "&" : "?"}$count=true&$top=1` : path;
  const { ok, status, body } = await g(p, headers);
  if (!ok) {
    const msg = body?.error?.message || `HTTP ${status}`;
    console.log(`  ✗ ${label.padEnd(30)} ${msg.slice(0, 70)}`);
    return null;
  }
  const n = body["@odata.count"] ?? (Array.isArray(body.value) ? body.value.length : 1);
  console.log(`  ✓ ${label.padEnd(30)} ${count ? n + " total" : "available"}`);
  return body;
}

// ---- run ----
AT = await getToken(process.argv.includes("--login"));

const org = await g("/organization?$select=displayName,verifiedDomains");
console.log("\nTenant:", org.body.value?.[0]?.displayName ?? "(unknown)");

console.log("\n── Directory ──");
await probe("Users", "/users", { count: true });
await probe("  enabled + licensed", "/users?$filter=accountEnabled eq true and assignedLicenses/$count ne 0", { count: true });
await probe("Groups", "/groups", { count: true });
await probe("Entra devices", "/devices", { count: true });
await probe("Domains", "/domains");
await probe("Directory roles", "/directoryRoles");

console.log("\n── Licensing ──");
const skus = await g("/subscribedSkus?$select=skuPartNumber,prepaidUnits,consumedUnits");
for (const s of skus.body.value ?? []) console.log(`  ${s.skuPartNumber.padEnd(34)} ${s.consumedUnits}/${s.prepaidUnits?.enabled}`);

console.log("\n── Security posture ──");
const sd = await g("/policies/identitySecurityDefaultsEnforcementPolicy");
if (sd.ok) console.log(`  Security defaults (tenant-wide MFA): ${sd.body.isEnabled ? "ON" : "OFF"}`);
else console.log("  ✗ Security defaults:", sd.body?.error?.message?.slice(0, 60));
await probe("Conditional Access policies", "/identity/conditionalAccess/policies");
await probe("Secure scores", "/security/secureScores?$top=1");
await probe("MFA registration report (P1)", "/reports/authenticationMethods/userRegistrationDetails?$top=1");

console.log("\n── Intune / endpoints ──");
await probe("Managed devices (Intune)", "/deviceManagement/managedDevices", { count: false });

console.log("\n── signInActivity on /users (P1-gated) ──");
const sia = await g("/users?$select=displayName,signInActivity&$top=3");
if (sia.ok && sia.body.value?.some((u) => u.signInActivity)) {
  for (const u of sia.body.value) console.log(`  ${(u.displayName ?? "").padEnd(24)} last sign-in: ${u.signInActivity?.lastSignInDateTime ?? "—"}`);
} else console.log("  ✗", sia.body?.error?.message?.slice(0, 70) ?? "no signInActivity (needs Entra P1)");

console.log("\n── Per-user MFA methods (works without P1) ──");
const sample = await g("/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses&$top=999");
const humans = (sample.body.value ?? []).filter((u) => u.accountEnabled && (u.assignedLicenses?.length ?? 0) > 0).slice(0, 6);
for (const u of humans) {
  const m = await g(`/users/${u.id}/authentication/methods`);
  const types = (m.body.value ?? []).map((x) => (x["@odata.type"] || "").replace("#microsoft.graph.", "").replace("AuthenticationMethod", ""));
  const strong = types.filter((t) => t !== "password");
  console.log(`  ${(u.displayName ?? "").slice(0, 22).padEnd(24)} ${strong.length ? "MFA: " + strong.join(",") : "password only"}`);
}
console.log("\nDone.");
