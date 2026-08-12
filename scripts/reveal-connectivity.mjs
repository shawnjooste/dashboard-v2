#!/usr/bin/env node
/**
 * One-off: give Connectivity back to client managers who have it explicitly
 * switched off in profiles.feature_overrides.
 *
 * Deliberately a script, not an admin page — this is expected to happen once
 * (the campaign of 2026-08-06). If a second bulk reveal comes up, that's the
 * moment to build the page.
 *
 *   node scripts/reveal-connectivity.mjs            # dry run — lists who
 *   node scripts/reveal-connectivity.mjs --apply    # writes
 *
 * Members are out of scope: the access model is subtractive, so clearing an
 * override cannot grant a member anything.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const apply = process.argv.includes("--apply");

const { data: rows, error } = await supabase
  .from("profiles")
  .select("id, email, client_id, role, feature_overrides")
  .eq("status", "active")
  .eq("role", "client_manager")
  .order("email");
if (error) throw new Error(error.message);

const { data: clients } = await supabase.from("clients").select("id, name");
const clientName = new Map((clients ?? []).map((c) => [c.id, c.name]));

const affected = (rows ?? []).filter(
  (r) =>
    r.feature_overrides &&
    typeof r.feature_overrides === "object" &&
    r.feature_overrides.connectivity === false,
);

console.log(`${rows?.length ?? 0} active managers · ${affected.length} with Connectivity switched off\n`);
for (const r of affected) {
  const rest = { ...r.feature_overrides };
  delete rest.connectivity;
  const remaining = Object.keys(rest);
  console.log(
    `  ${(clientName.get(r.client_id) ?? "—").padEnd(30)} ${r.email.padEnd(38)} ` +
      `→ ${remaining.length ? `keeps off: ${remaining.join(", ")}` : "no overrides left"}`,
  );
}

if (!apply) {
  console.log(`\nDry run. Re-run with --apply to clear 'connectivity' for these ${affected.length} users.`);
  process.exit(0);
}

let done = 0;
for (const r of affected) {
  const rest = { ...r.feature_overrides };
  delete rest.connectivity;
  const next = Object.keys(rest).length ? rest : null;
  const { error: upErr } = await supabase
    .from("profiles")
    .update({ feature_overrides: next })
    .eq("id", r.id)
    .eq("role", "client_manager");
  if (upErr) {
    console.error(`  FAILED ${r.email}: ${upErr.message}`);
    continue;
  }
  done++;
}

const { count: still } = await supabase
  .from("profiles")
  .select("id", { count: "exact", head: true })
  .eq("status", "active")
  .eq("role", "client_manager")
  .eq("feature_overrides->>connectivity", "false");

console.log(`\nUpdated ${done}/${affected.length}. Managers still hiding Connectivity: ${still ?? "?"} (expect 0).`);
