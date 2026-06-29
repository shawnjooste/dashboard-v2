// Concargo agent — refreshes Concargo's Datto data in the portal.
// Reads this folder's config.json and runs the canonical Datto pull scoped to
// Concargo's site only. Idempotent; touches no other client's data.
//
//   node clients/concargo/sync.mjs
//
// (Equivalent to: node scripts/datto-pull.mjs --site "Concargo")
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const cfg = JSON.parse(readFileSync(join(here, "config.json"), "utf8"));

console.log(`[${cfg.displayName}] syncing Datto site "${cfg.dattoSiteName}" -> portal…`);
const r = spawnSync(
  process.execPath,
  [join(repoRoot, "scripts", "datto-pull.mjs"), "--site", cfg.dattoSiteName],
  { cwd: repoRoot, stdio: "inherit" },
);
process.exit(r.status ?? 1);
