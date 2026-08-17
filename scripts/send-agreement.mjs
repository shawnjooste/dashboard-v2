// Sends an existing draft agreement for signature from the command line,
// using the portal's own notification chokepoint so the email is recorded in
// sent_emails exactly as a send from /admin/agreements would be.
//
//   node --import tsx scripts/send-agreement.mjs <agreementId> [--dry-run]
//
// --dry-run resolves and prints the recipients without sending or changing
// the agreement's status.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const [id] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");
if (!id) {
  console.error("usage: send-agreement.mjs <agreementId> [--dry-run]");
  process.exit(1);
}

const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { canAccess, toOverrides } = await import("../lib/feature-access.ts");

const { data: agr, error } = await svc
  .from("agreements")
  .select("id, reference, title, status, client_id")
  .eq("id", id)
  .maybeSingle();
if (error) throw new Error(error.message);
if (!agr) throw new Error(`no agreement ${id}`);
if (agr.status !== "draft") throw new Error(`agreement ${agr.reference} is ${agr.status}, not a draft`);

const [{ data: managers }, { data: client }] = await Promise.all([
  svc
    .from("profiles")
    .select("email, feature_overrides")
    .eq("client_id", agr.client_id)
    .eq("role", "client_manager")
    .eq("status", "active")
    .order("email"),
  svc.from("clients").select("name").eq("id", agr.client_id).maybeSingle(),
]);
const to = (managers ?? [])
  .filter((p) => canAccess("client_manager", toOverrides(p.feature_overrides), "agreements"))
  .map((p) => p.email);

console.log(`${agr.reference} — ${agr.title}`);
console.log(`client:     ${client?.name}`);
console.log(`recipients: ${to.join(", ") || "(none)"}`);
if (dryRun) {
  console.log("\ndry run — nothing sent, status unchanged");
  process.exit(0);
}
if (!to.length) throw new Error("no eligible recipients — refusing to mark it sent");

// Build the message BEFORE touching the agreement's status. An import or
// template failure after the status flip would leave the agreement marked
// sent with nothing delivered — which is exactly what happened the first time.
// lib/notify.ts is server-only and unimportable here; deliver.ts is the
// script-safe door, and the body comes from the same module the portal uses.
const { deliverEmail } = await import("../lib/email/deliver.ts");
const { agreementForSignatureEmail } = await import("../lib/email/agreement-email.ts");
const { subject, html } = agreementForSignatureEmail({
  reference: agr.reference,
  title: agr.title,
  companyName: client?.name ?? "your company",
  agreementId: agr.id,
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one",
});

const { data: sent, error: se } = await svc
  .from("agreements")
  .update({ status: "sent", sent_at: new Date().toISOString() })
  .eq("id", id)
  .eq("status", "draft")
  .select("reference, sent_at")
  .maybeSingle();
if (se) throw new Error(se.message);
if (!sent) throw new Error("the agreement was no longer a draft");

try {
  await deliverEmail(svc, {
    to,
    subject,
    replyTo: "support@rocking.co.za",
    category: "agreement",
    audience: "client",
    clientId: agr.client_id,
    html,
  });
} catch (e) {
  // Put it back rather than leave a "sent" agreement nobody was told about.
  await svc.from("agreements").update({ status: "draft", sent_at: null }).eq("id", id);
  throw e;
}

console.log(`\nsent ${sent.reference} at ${sent.sent_at}`);
