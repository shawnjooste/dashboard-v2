// Mint, list, and revoke API keys for the scoped quote API (api_keys table).
// Keys let the team and an AI agent DRAFT quotes without being able to EMAIL
// clients — see .superpowers/sdd/2026-08-13-quote-api/task-1-brief.md.
//
//   node scripts/api-key.mjs mint "Hermes"                      # no profile
//   node scripts/api-key.mjs mint "Kelle" --profile kelle@rocking.one
//   node scripts/api-key.mjs list
//   node scripts/api-key.mjs revoke <key-id>
//
// mint prints the raw key ONCE — copy it now, it is never shown again (only
// its sha256 hash is stored). --profile resolves a profiles row by email
// (case-insensitive) and requires exactly one ACTIVE match, else it errors
// listing what matched. revoke takes the key's uuid id (from `list`), not
// its prefix.

import { randomBytes, createHash } from "crypto";
import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { escapeLike } from "../lib/quotes/api-input.ts";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const USAGE = `usage:
  node scripts/api-key.mjs mint "<name>" [--profile <email>]
  node scripts/api-key.mjs list
  node scripts/api-key.mjs revoke <key-id>`;

const args = process.argv.slice(2);
const cmd = args[0];

async function resolveProfile(email) {
  const { data, error } = await sb.from("profiles").select("id, email, status").ilike("email", escapeLike(email));
  if (error) {
    console.error("profile lookup failed:", error.message);
    process.exit(1);
  }
  const active = (data ?? []).filter((p) => p.status === "active");
  if (active.length === 1) return active[0];

  const seen = (data ?? []).map((p) => `${p.email} [${p.status}]`).join(", ") || "none";
  if (active.length === 0) {
    console.error(`no ACTIVE profile matches "${email}" — matched: ${seen}`);
  } else {
    console.error(`multiple ACTIVE profiles match "${email}": ${active.map((p) => p.email).join(", ")}`);
  }
  process.exit(1);
}

async function mint() {
  const name = args[1];
  if (!name || name.startsWith("--")) {
    console.error(USAGE);
    process.exit(1);
  }
  const profileIdx = args.indexOf("--profile");
  const profileEmail = profileIdx !== -1 ? args[profileIdx + 1] : null;

  let profile = null;
  if (profileEmail) profile = await resolveProfile(profileEmail);

  const raw = "rq_live_" + randomBytes(24).toString("base64url");
  const key_hash = createHash("sha256").update(raw).digest("hex");
  const key_prefix = raw.slice(0, 12);

  const { data: row, error } = await sb
    .from("api_keys")
    .insert({ name, key_hash, key_prefix, profile_id: profile?.id ?? null })
    .select("id, name, key_prefix, created_at")
    .single();
  if (error) {
    console.error("mint failed:", error.message);
    process.exit(1);
  }

  console.log(`Name:      ${row.name}`);
  console.log(`Key ID:    ${row.id}`);
  console.log(`Profile:   ${profile ? profile.email : "— (no profile)"}`);
  console.log(`Created:   ${row.created_at}`);
  console.log(`\nKey:       ${raw}`);
  console.log(`\nWARNING: this is the only time the full key is shown. Store it now — it cannot be retrieved again, only revoked.`);
}

async function list() {
  const { data: keys, error } = await sb
    .from("api_keys")
    .select("id, name, key_prefix, profile_id, created_at, last_used_at, revoked_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("list failed:", error.message);
    process.exit(1);
  }

  const profileIds = [...new Set((keys ?? []).map((k) => k.profile_id).filter(Boolean))];
  let emailById = new Map();
  if (profileIds.length) {
    const { data: profiles } = await sb.from("profiles").select("id, email").in("id", profileIds);
    emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]));
  }

  if (!keys?.length) {
    console.log("no API keys yet.");
    return;
  }

  for (const k of keys) {
    const profileLabel = k.profile_id ? (emailById.get(k.profile_id) ?? `${k.profile_id} (profile deleted)`) : "—";
    console.log(`${k.id}`);
    console.log(
      `  name: ${k.name}  prefix: ${k.key_prefix}  profile: ${profileLabel}`,
    );
    console.log(
      `  created: ${k.created_at}  last_used: ${k.last_used_at ?? "never"}  revoked: ${k.revoked_at ?? "no"}`,
    );
  }
  console.log(`\n${keys.length} key(s).`);
}

async function revoke() {
  const id = args[1];
  if (!id || id.startsWith("--")) {
    console.error(USAGE);
    process.exit(1);
  }

  const { data: existing, error: fetchErr } = await sb
    .from("api_keys")
    .select("id, name, revoked_at")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    console.error("revoke failed:", fetchErr.message);
    process.exit(1);
  }
  if (!existing) {
    console.error(`no api key with id "${id}"`);
    process.exit(1);
  }
  if (existing.revoked_at) {
    console.log(`"${existing.name}" (${existing.id}) was already revoked at ${existing.revoked_at}.`);
    return;
  }

  const { data: row, error } = await sb
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, name, revoked_at")
    .single();
  if (error) {
    console.error("revoke failed:", error.message);
    process.exit(1);
  }
  console.log(`"${row.name}" (${row.id}) revoked at ${row.revoked_at}.`);
}

switch (cmd) {
  case "mint":
    await mint();
    break;
  case "list":
    await list();
    break;
  case "revoke":
    await revoke();
    break;
  default:
    console.error(USAGE);
    process.exit(1);
}
