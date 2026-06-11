// Pull a connected M365 tenant headlessly and ingest. Idempotent.
//
//   node scripts/m365-pull.mjs <clientId>
//   node scripts/m365-pull.mjs --all

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  refreshAccessToken, graphAll, graphGet, encryptSecret, decryptSecret,
} from "../lib/m365-graph.mjs";

const arg = process.argv[2];
if (!arg) { console.error("Usage: node scripts/m365-pull.mjs <clientId>|--all"); process.exit(1); }

const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const encKey = env.M365_TOKEN_ENC_KEY;
if (!encKey) throw new Error("M365_TOKEN_ENC_KEY missing");

const reportDate = new Date().toISOString().slice(0, 10);

let q = sb.from("m365_connections").select("*");
q = arg === "--all" ? q : q.eq("client_id", arg);
const { data: connections } = await q;
if (!connections || connections.length === 0) {
  console.error("No matching m365_connections. Run m365-connect first.");
  process.exit(1);
}

for (const conn of connections) {
  await pullOne(conn).catch((e) => console.error(`✗ ${conn.client_id}: ${e.message}`));
}

async function pullOne(conn) {
  // Refresh (and rotate) the token.
  let refreshed;
  try {
    refreshed = await refreshAccessToken(
      decryptSecret({ ciphertext: conn.token_ciphertext, iv: conn.token_iv, tag: conn.token_tag }, encKey),
    );
  } catch (e) {
    if (e.code === "invalid_grant") {
      await sb.from("m365_connections").update({ status: "reauth_required" }).eq("client_id", conn.client_id);
      throw new Error("token expired/revoked — re-run m365-connect");
    }
    throw e;
  }
  const at = refreshed.access_token;
  if (refreshed.refresh_token) {
    const enc = encryptSecret(refreshed.refresh_token, encKey);
    await sb.from("m365_connections").update({
      token_ciphertext: enc.ciphertext, token_iv: enc.iv, token_tag: enc.tag,
    }).eq("client_id", conn.client_id);
  }

  // import run
  const { data: run } = await sb.from("import_runs")
    .insert({ source: "m365", report_date: reportDate, file_names: [] })
    .select("id").single();
  const runId = run.id;
  const counts = { skipped: [] };

  // licenses
  const skus = await graphAll(at, "/subscribedSkus?$select=skuId,skuPartNumber,prepaidUnits,consumedUnits");
  const licenseRows = skus.map((s) => ({
    client_id: conn.client_id, sku_part_number: s.skuPartNumber,
    total: s.prepaidUnits?.enabled ?? null, consumed: s.consumedUnits ?? null,
    last_import_run_id: runId,
  }));
  if (licenseRows.length) await sb.from("m365_licenses").upsert(licenseRows, { onConflict: "client_id,sku_part_number" });
  counts.licenses = licenseRows.length;

  // users
  const users = await graphAll(
    at, "/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses&$top=999",
  );
  const userRows = [];
  for (const u of users) {
    const isLicensed = (u.assignedLicenses?.length ?? 0) > 0;
    let methods = [];
    if (u.accountEnabled) {
      // Auth methods work without Entra P1; only fetch for enabled accounts.
      const m = await graphGet(at, `/users/${u.id}/authentication/methods`);
      if (m.ok) methods = (m.body.value ?? []).map((x) => x["@odata.type"] ?? "");
    }
    const mfaStrong = methods.some((t) => !t.toLowerCase().includes("password"));

    // Active accounts with an email become canonical people (identity layer).
    let personId = null;
    if (u.accountEnabled && u.userPrincipalName) {
      const { data } = await sb.rpc("upsert_person", {
        p_client_id: conn.client_id, p_email: u.userPrincipalName,
        p_display_name: u.displayName ?? null, p_is_active: true,
      });
      personId = data ?? null;
    }

    userRows.push({
      client_id: conn.client_id, m365_user_id: u.id, display_name: u.displayName ?? null,
      user_principal_name: u.userPrincipalName ?? null, account_enabled: u.accountEnabled ?? null,
      is_licensed: isLicensed,
      assigned_licenses: (u.assignedLicenses ?? []).map((l) => skuPart(skus, l.skuId)).filter(Boolean),
      mfa_methods: methods, mfa_strong: mfaStrong, person_id: personId, last_import_run_id: runId,
    });
  }
  if (userRows.length) await sb.from("m365_users").upsert(userRows, { onConflict: "client_id,m365_user_id" });
  counts.users = userRows.length;

  // security posture
  const sd = await graphGet(at, "/policies/identitySecurityDefaultsEnforcementPolicy");
  const securityDefaultsOn = sd.ok ? !!sd.body.isEnabled : null;
  if (!sd.ok) counts.skipped.push("securityDefaults");

  const ca = await graphGet(at, "/identity/conditionalAccess/policies?$select=id");
  const caCount = ca.ok ? (ca.body.value?.length ?? 0) : null;
  if (!ca.ok) counts.skipped.push("conditionalAccess");

  const ss = await graphGet(at, "/security/secureScores?$top=1");
  const score = ss.ok ? ss.body.value?.[0] : null;
  if (!ss.ok) counts.skipped.push("secureScore");

  // MFA metrics are over ACTIVE (enabled + licensed) users — the people who can
  // actually sign in. Disabled licensed leavers don't count for/against coverage.
  const activeLicensed = userRows.filter((u) => u.is_licensed && u.account_enabled);
  const strongCount = activeLicensed.filter((u) => u.mfa_strong).length;
  const coverage = activeLicensed.length ? Math.round((100 * strongCount) / activeLicensed.length) : null;
  const passwordOnly = activeLicensed.filter((u) => !u.mfa_strong).length;

  await sb.from("m365_tenant").upsert({
    client_id: conn.client_id, security_defaults_on: securityDefaultsOn, ca_policy_count: caCount,
    secure_score: score?.currentScore ?? null, secure_score_max: score?.maxScore ?? null,
    licensed_user_count: activeLicensed.length, mfa_strong_count: strongCount, last_import_run_id: runId,
  }, { onConflict: "client_id" });

  await sb.from("m365_snapshots").upsert({
    client_id: conn.client_id, snapshot_date: reportDate, licensed_users: activeLicensed.length,
    mfa_coverage_pct: coverage, security_defaults_on: securityDefaultsOn,
    password_only_count: passwordOnly, import_run_id: runId,
  }, { onConflict: "client_id,snapshot_date" });

  await sb.from("import_runs").update({ counts }).eq("id", runId);
  await sb.from("m365_connections").update({ last_pull_at: new Date().toISOString(), status: "connected" })
    .eq("client_id", conn.client_id);

  console.log(`✓ ${conn.tenant_name ?? conn.client_id}: ${counts.users} users, ${counts.licenses} SKUs, ` +
    `MFA ${coverage ?? "—"}% (${passwordOnly} licensed w/o MFA), security-defaults ` +
    `${securityDefaultsOn === null ? "?" : securityDefaultsOn ? "ON" : "OFF"}` +
    (counts.skipped.length ? ` [skipped: ${counts.skipped.join(",")}]` : ""));
}

function skuPart(skus, skuId) {
  return skus.find((s) => s.skuId === skuId)?.skuPartNumber ?? null;
}
