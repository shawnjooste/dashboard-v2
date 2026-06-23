// Creates a job linked to an existing quote.
//
//   node scripts/create-job.mjs <quoteId> [--owner <profileId>]
//
// Mirrors the createJobFromQuote server action (app/(admin)/admin/jobs/actions.ts):
//   - fetches client_id + title from the quote
//   - inserts the job with quote_id set
//   - inserts the standard 4-task checklist
//   - inserts an 'opened' job_update (no email — script doesn't send Resend)
//
// The job will appear immediately on the Kanban board at /admin/jobs.

import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";

// ---------- env ----------
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ---------- args ----------
const args = process.argv.slice(2);
const quoteId = args[0];
if (!quoteId) {
  console.error("usage: node scripts/create-job.mjs <quoteId> [--owner <profileId>]");
  process.exit(1);
}
const ownerIdx = args.indexOf("--owner");
const ownerProfileId = ownerIdx !== -1 ? args[ownerIdx + 1] : null;

// ---------- standard tasks (mirrors FROM_QUOTE_TASKS in actions.ts) ----------
const TASKS = [
  "Place supplier order",
  "Confirm delivery / lead time",
  "Schedule / dispatch",
  "Confirm completion with client",
];

// ---------- fetch quote ----------
const { data: quote, error: qErr } = await sb
  .from("quotes")
  .select("client_id, title, quote_number")
  .eq("id", quoteId)
  .maybeSingle();
if (qErr || !quote) {
  console.error("quote not found:", qErr?.message ?? quoteId);
  process.exit(1);
}
console.log(`Quote:  ${quote.quote_number} — ${quote.title}`);
console.log(`Client: ${quote.client_id}`);

// ---------- insert job ----------
const { data: job, error: jErr } = await sb
  .from("jobs")
  .insert({
    client_id: quote.client_id,
    title: quote.title,
    owner_profile_id: ownerProfileId ?? null,
    notes: null,
    quote_id: quoteId,
  })
  .select("id")
  .single();
if (jErr) {
  console.error("failed to create job:", jErr.message);
  process.exit(1);
}
console.log(`Job ID: ${job.id}`);

// ---------- insert tasks ----------
const { error: tErr } = await sb
  .from("job_tasks")
  .insert(TASKS.map((label, i) => ({ job_id: job.id, label, position: i })));
if (tErr) {
  console.error("failed to insert tasks:", tErr.message);
  process.exit(1);
}
console.log(`Tasks:  ${TASKS.length} created`);

// ---------- insert opened update ----------
const actorId = ownerProfileId ?? null;
const { error: uErr } = await sb
  .from("job_updates")
  .insert({ job_id: job.id, kind: "opened", posted_by_profile_id: actorId, emailed_count: 0 });
if (uErr) {
  console.error("failed to insert job_update:", uErr.message);
  process.exit(1);
}

console.log("\nJob created successfully.");
console.log(`  /admin/jobs/${job.id}`);
