#!/usr/bin/env node
/**
 * Enrol one client's people in the onboarding sequence.
 *
 *   node scripts/onboarding-enrol.mjs --client "GSR" [--dry-run]
 *
 * There is no bulk mode and no "all clients" flag on purpose: enrolling is a
 * decision to email real customers, taken one client at a time. Re-running is
 * safe — people already active in the sequence are reported and left alone,
 * so their enrolled_at (and every day floor derived from it) never moves.
 *
 * `onboarding_sequence_state.status` can be 'active' or 'stopped'. The daily
 * drip runner (app/api/jobs/onboarding-drip/route.ts) only loads status =
 * 'active' rows, and `enrolInOnboarding` upserts with ignoreDuplicates, so a
 * profile with a 'stopped' row can never re-enter the sequence on its own —
 * stopped is terminal. Someone who was deactivated and later reactivated
 * would otherwise sit in a stopped row forever, invisible to both "already
 * enrolled" and "to enrol" counts, and quietly receive nothing. This script
 * treats "previously stopped" as its own group: it is reported explicitly,
 * and confirming resumes those rows (status back to 'active', enrolled_at
 * reset to now — they are starting the tour again) alongside inserting rows
 * for people who were never enrolled at all.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const name = args[args.indexOf("--client") + 1];
if (!args.includes("--client") || !name) {
  console.error('Usage: node scripts/onboarding-enrol.mjs --client "Name" [--dry-run]');
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);

const { data: clients, error: clientsError } = await db
  .from("clients")
  .select("id, name")
  .ilike("name", `%${name}%`);
if (clientsError) {
  console.error("Failed to look up client:", clientsError.message);
  process.exit(1);
}
if (!clients?.length) {
  console.error(`No client matching "${name}".`);
  process.exit(1);
}
if (clients.length > 1) {
  // Never guess which customer to email.
  console.error(`"${name}" matches ${clients.length} clients — be more specific:`);
  for (const c of clients) console.error(`  ${c.name}`);
  process.exit(1);
}
const client = clients[0];

const { data: profiles, error: profilesError } = await db
  .from("profiles")
  .select("id, email, role")
  .eq("client_id", client.id)
  .eq("status", "active")
  .in("role", ["client_manager", "client_member"]);
if (profilesError) {
  console.error("Failed to look up profiles:", profilesError.message);
  process.exit(1);
}

const { data: state, error: stateError } = await db
  .from("onboarding_sequence_state")
  .select("profile_id, status")
  .in("profile_id", (profiles ?? []).map((p) => p.id));
if (stateError) {
  console.error("Failed to look up onboarding state:", stateError.message);
  process.exit(1);
}
const stateByProfile = new Map((state ?? []).map((r) => [r.profile_id, r.status]));

// Three groups, not two: a row with status 'stopped' is neither "already
// enrolled" (it gets no emails today) nor "to enrol" via plain insert (the
// unique profile_id row already exists) — it needs its own path.
const active = [];
const stopped = [];
const neverEnrolled = [];
for (const p of profiles ?? []) {
  const status = stateByProfile.get(p.id);
  if (status === "active") active.push(p);
  else if (status === "stopped") stopped.push(p);
  else neverEnrolled.push(p);
}

console.log(`\nClient: ${client.name}`);
console.log(`Active portal users:      ${profiles?.length ?? 0}`);
console.log(`Already enrolled:         ${active.length}`);
console.log(`Previously stopped:       ${stopped.length}  (will resume, not counted as new)`);
console.log(`To enrol (never before):  ${neverEnrolled.length}\n`);

if (neverEnrolled.length) {
  console.log("New:");
  for (const p of neverEnrolled) console.log(`  ${p.role.padEnd(15)} ${p.email}`);
}
if (stopped.length) {
  console.log("\nPreviously stopped (will resume at day 0):");
  for (const p of stopped) console.log(`  ${p.role.padEnd(15)} ${p.email}`);
}

const total = neverEnrolled.length + stopped.length;
if (!total) {
  console.log("\nNothing to do.");
  process.exit(0);
}

console.log(
  "\nThey will start at day 0. Steps they already use settle silently on the" +
    "\nfirst run; they are emailed only about the parts they have not used.\n",
);

if (dryRun) {
  console.log("--dry-run: nothing written.");
  process.exit(0);
}

process.stdout.write(
  `Enrol ${neverEnrolled.length} new and resume ${stopped.length} previously-stopped people? (yes/no) `,
);
const answer = await new Promise((r) => process.stdin.once("data", (d) => r(d.toString().trim())));
if (answer !== "yes") {
  console.log("Aborted.");
  process.exit(0);
}

if (neverEnrolled.length) {
  const { error } = await db
    .from("onboarding_sequence_state")
    .insert(neverEnrolled.map((p) => ({ profile_id: p.id })));
  if (error) {
    console.error("Failed to insert new enrolments:", error.message);
    process.exit(1);
  }
}

if (stopped.length) {
  const { error } = await db
    .from("onboarding_sequence_state")
    .update({ status: "active", enrolled_at: new Date().toISOString() })
    .in("profile_id", stopped.map((p) => p.id));
  if (error) {
    console.error("Failed to resume stopped enrolments:", error.message);
    process.exit(1);
  }
}

console.log(
  `Enrolled ${neverEnrolled.length} new, resumed ${stopped.length} stopped. ` +
    "They receive their first step on the next daily run.",
);
process.exit(0);
