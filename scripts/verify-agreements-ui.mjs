// Sets up (or tears down) a throwaway client + manager + sent agreement so the
// agreements UI can be driven end-to-end against the local dev server.
//
//   node scripts/verify-agreements-ui.mjs setup     # prints a sign-in URL
//   node scripts/verify-agreements-ui.mjs teardown  # removes everything
//
// State lives in scripts/.verify-ui.json (gitignored) between the two runs.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const STATE = new URL("./.verify-ui.json", import.meta.url);
const BASE = process.env.VERIFY_BASE_URL ?? "http://localhost:3000";

const BODY = `# Managed IT Services Agreement

This agreement is between **Rocking (Pty) Ltd** and the Client named above.

## 1. Scope of services

1. Rocking One will monitor and maintain the Client's **workstations, servers and network devices**.
2. Rocking One will provide remote support during business hours, being 08:00 to 17:00 on weekdays excluding public holidays, and will respond to logged requests within the response times set out in the Client's support package.
3. On-site attendance is arranged by agreement and is billed separately unless the Client's package includes it.

## 2. Client responsibilities

- Provide safe and reasonable access to premises, systems and equipment.
- Nominate a primary contact for approvals.
- Keep licensing for third-party software current.

## 3. Term and termination

1. This agreement runs for twelve (12) months from the date of signature and continues month-to-month thereafter.
2. Either party may terminate on thirty (30) days' written notice.
`;

async function setup() {
  const stamp = Date.now();
  const { data: client } = await svc
    .from("clients")
    .insert({ name: `ZZ UI Verify ${stamp}`, status: "active" })
    .select("id, name")
    .single();

  const email = `zz-ui-verify-${stamp}@rocking.one`;
  const { data: user, error: ue } = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (ue) throw ue;
  await svc
    .from("profiles")
    .upsert({ id: user.user.id, email, role: "client_manager", client_id: client.id, status: "active" });

  const { data: agr } = await svc
    .from("agreements")
    .insert({
      client_id: client.id,
      title: "Managed IT Services Agreement",
      body_md: BODY,
      status: "sent",
      sent_at: new Date().toISOString(),
    })
    .select("id, reference")
    .single();

  const { data: link, error: le } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  if (le) throw le;

  const state = { clientId: client.id, userId: user.user.id, agreementId: agr.id, email };
  writeFileSync(STATE, JSON.stringify(state, null, 2));

  console.log(`client:     ${client.name} (${client.id})`);
  console.log(`manager:    ${email}`);
  console.log(`agreement:  ${agr.reference} (${agr.id})`);
  console.log(`\nsign-in URL:\n${BASE}/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink&next=/agreements\n`);
}

/** A throwaway rocking_staff login, so the admin surfaces can be checked
 *  without signing into anyone's real account. Removed by teardown. */
async function staff() {
  const s = JSON.parse(readFileSync(STATE, "utf8"));
  const email = `zz-ui-staff-${Date.now()}@rocking.one`;
  const { data: user, error } = await svc.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw error;
  await svc.from("profiles").upsert({ id: user.user.id, email, role: "rocking_staff", status: "active" });
  const { data: link } = await svc.auth.admin.generateLink({ type: "magiclink", email });
  s.staffUserId = user.user.id;
  writeFileSync(STATE, JSON.stringify(s, null, 2));
  console.log(`${BASE}/auth/confirm?token_hash=${link.properties.hashed_token}&type=magiclink&next=/admin/agreements`);
}

async function teardown() {
  if (!existsSync(STATE)) return console.log("nothing to tear down");
  const s = JSON.parse(readFileSync(STATE, "utf8"));
  await svc.storage.from("agreement-pdfs").remove([`${s.clientId}/${s.agreementId}.pdf`]);
  const del = await svc.from("agreements").delete().eq("id", s.agreementId);
  if (del.error) console.log(`  ! agreement: ${del.error.message}`);
  await svc.auth.admin.deleteUser(s.userId);
  if (s.staffUserId) await svc.auth.admin.deleteUser(s.staffUserId);
  const dc = await svc.from("clients").delete().eq("id", s.clientId);
  if (dc.error) console.log(`  ! client: ${dc.error.message}`);
  unlinkSync(STATE);

  const left = await svc.from("clients").select("id").ilike("name", "ZZ UI Verify%");
  console.log(`removed. ZZ UI Verify clients left: ${(left.data ?? []).length}`);
}

const cmd = process.argv[2];
if (cmd === "setup") await setup();
else if (cmd === "staff") await staff();
else if (cmd === "teardown") await teardown();
else console.log("usage: verify-agreements-ui.mjs setup|staff|teardown");
