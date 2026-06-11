// M365 device-code probe. Uses Microsoft's first-party "Microsoft Graph
// Command Line Tools" app (pre-registered in every tenant) — NO Azure app
// registration needed. Sign in once as the client's admin; we pull users,
// their licenses, and MFA registration status.
//
//   node scripts/m365-probe.mjs
//
// Prints a device code to enter at https://microsoft.com/devicelogin.

// Microsoft Graph Command Line Tools — Microsoft's own public client app id.
const CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
const TENANT = "organizations";
const SCOPES = "User.Read.All Organization.Read.All AuditLog.Read.All offline_access";
const BASE = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0`;
const GRAPH = "https://graph.microsoft.com/v1.0";

const form = (o) => new URLSearchParams(o).toString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getToken() {
  const dc = await (
    await fetch(`${BASE}/devicecode`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form({ client_id: CLIENT_ID, scope: SCOPES }),
    })
  ).json();
  if (!dc.device_code) throw new Error("devicecode failed: " + JSON.stringify(dc));

  console.log("\n┌─────────────────────────────────────────────");
  console.log("│  Open:  " + dc.verification_uri);
  console.log("│  Code:  " + dc.user_code);
  console.log("│  Sign in as the CLIENT's M365 admin account.");
  console.log("└─────────────────────────────────────────────\n");

  const deadline = Date.now() + dc.expires_in * 1000;
  let interval = (dc.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const r = await (
      await fetch(`${BASE}/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: CLIENT_ID,
          device_code: dc.device_code,
        }),
      })
    ).json();
    if (r.access_token) return r;
    if (r.error === "authorization_pending") continue;
    if (r.error === "slow_down") { interval += 5000; continue; }
    throw new Error("token error: " + (r.error_description || r.error));
  }
  throw new Error("device code expired before sign-in");
}

async function graphAll(token, path) {
  let url = `${GRAPH}${path}`;
  const out = [];
  while (url) {
    const r = await (
      await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    ).json();
    if (r.error) throw new Error(`${path}: ${r.error.message}`);
    out.push(...(r.value ?? []));
    url = r["@odata.nextLink"] ?? null;
  }
  return out;
}

const tok = await getToken();
const at = tok.access_token;
console.log("✓ signed in. refresh_token captured:", !!tok.refresh_token, "\n");

// org name
const org = await graphAll(at, "/organization?$select=displayName");
console.log("Tenant:", org[0]?.displayName ?? "(unknown)");

// SKU GUID -> friendly name
const skus = await graphAll(at, "/subscribedSkus?$select=skuId,skuPartNumber,prepaidUnits,consumedUnits");
const skuName = new Map(skus.map((s) => [s.skuId, s.skuPartNumber]));
console.log("\nLicenses owned:");
for (const s of skus) console.log(`  ${s.skuPartNumber}: ${s.consumedUnits}/${s.prepaidUnits?.enabled} used`);

// users + their licenses
const users = await graphAll(
  at,
  "/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses&$top=999",
);

// MFA registration report (may need Entra P1)
let mfaBy = new Map();
try {
  const mfa = await graphAll(
    at,
    "/reports/authenticationMethods/userRegistrationDetails?$select=userPrincipalName,isMfaRegistered,isMfaCapable,methodsRegistered",
  );
  mfaBy = new Map(mfa.map((m) => [m.userPrincipalName?.toLowerCase(), m]));
  console.log("\n✓ MFA registration report available (Entra P1 present).");
} catch (e) {
  console.log("\n⚠ MFA report unavailable (likely no Entra P1):", e.message);
}

console.log(`\nUsers (${users.length}):\n`);
console.log("Name".padEnd(26) + "Enabled  MFA   Licenses");
for (const u of users.slice(0, 40)) {
  const lic = (u.assignedLicenses ?? []).map((l) => skuName.get(l.skuId) ?? "?").join(",") || "—";
  const m = mfaBy.get(u.userPrincipalName?.toLowerCase());
  const mfa = m ? (m.isMfaRegistered ? "yes" : "no") : "?";
  console.log(`${(u.displayName ?? "").slice(0, 24).padEnd(26)}${String(u.accountEnabled).padEnd(9)}${mfa.padEnd(6)}${lic.slice(0, 60)}`);
}
if (users.length > 40) console.log(`  … and ${users.length - 40} more`);
