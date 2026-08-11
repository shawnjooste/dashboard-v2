#!/usr/bin/env node
/**
 * Show exactly what the next drip run would do.
 *
 *   node scripts/onboarding-dry-run.mjs [--url https://portal.rocking.one]
 *
 * A thin client over /api/jobs/onboarding-drip?dry=1 — deliberately NOT a
 * second implementation of the decision logic, so the preview cannot disagree
 * with the real run.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const args = process.argv.slice(2);
const base = args.includes("--url") ? args[args.indexOf("--url") + 1] : "https://portal.rocking.one";

const res = await fetch(`${base}/api/jobs/onboarding-drip?dry=1`, {
  headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
});
if (!res.ok) {
  console.error(`${res.status} ${res.statusText}`);
  process.exit(1);
}
const r = await res.json();

console.log(`\nEnrolled:      ${r.enrolled}`);
console.log(`Would send:    ${r.wouldSend}`);
console.log(`Would settle:  ${r.wouldSettle}   (already using it, or opted out)`);
console.log(`Would stop:    ${r.wouldStop}     (no longer active)`);
if (r.capped) console.log("CAPPED — the 200-send limit was hit.");
console.log("");
for (const d of r.decisions ?? []) {
  console.log(`  ${d.outcome.padEnd(22)} ${d.step.padEnd(14)} ${d.email}`);
}
console.log("");
