// One-off broadcast: tell every active portal user about the status page.
//
//   node scripts/announce-status-page.mjs --dry-run
//   node scripts/announce-status-page.mjs --only jooste@gmail.com
//   node scripts/announce-status-page.mjs --confirm-send-all
//
// One message PER RECIPIENT — never a shared `to:` array, which would leak
// customer addresses to each other and misfile the sent_emails row (it carries
// a single client_id). Mirrors lib/email/send.ts: every send is recorded, so
// the broadcast shows up in the admin Activity feed and in each client's
// Communications history.
import { readFileSync } from "node:fs";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND = env.RESEND_API_KEY;
const APP_URL = env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";
const FROM = '"Rocking" <no-reply@send.rocking.one>';
const REPLY_TO = "support@rocking.co.za";
const SUBJECT = "A status page for your Rocking portal";

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const get = async (path) => {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return r.json();
};

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const sendAll = args.includes("--confirm-send-all");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
if (!dryRun && !sendAll && !only) {
  console.error("Refusing to run. Pass --dry-run, --only <email>, or --confirm-send-all.");
  process.exit(1);
}

// A stored first name is only used when it reads like one. Shared mailboxes
// mostly have a real person behind them, but a name of "Accounts" would make
// the greeting worse than no greeting at all.
const ROLE_WORDS = new Set([
  "accounts", "account", "admin", "info", "finance", "billing", "support",
  "office", "creditors", "debtors", "ap", "team", "reception", "sales", "it",
]);
function greetingName(raw) {
  const name = (raw ?? "").trim();
  if (!/^[\p{L}'’-]{2,20}$/u.test(name)) return null;
  if (ROLE_WORDS.has(name.toLowerCase())) return null;
  return name;
}

function html(name) {
  const hello = name ? `Hi ${name},` : "Hi there,";
  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1a1a;">
  <p style="margin:0 0 16px;font-size:15px;">${hello}</p>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
    We've added a <strong>status page</strong> to your Rocking portal.
  </p>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
    When something goes wrong — a power outage at an office park, a provider issue,
    planned maintenance — we post it there and keep it updated as we work through it.
    No need to phone in to find out whether it's just you.
  </p>
  <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
    You'll find it in the top right of the portal, next to your initials.
    <strong>Green means all clear. Red means something's open.</strong>
  </p>
  <p style="margin:0 0 22px;font-size:15px;line-height:1.55;">
    You can also switch on email updates. One click on the status page and we'll email you
    whenever something new is posted, every time it changes, and again when it's resolved.
    It's off unless you turn it on.
  </p>
  <a href="${APP_URL}/status" style="display:inline-block;background:#D7141C;color:#fff;text-decoration:none;font-weight:600;padding:11px 22px;border-radius:8px;font-size:14.5px;">View the status page</a>
  <p style="margin:22px 0 0;font-size:15px;line-height:1.55;">
    Nothing else changes — support works exactly as it always has.
  </p>
  <p style="margin:16px 0 0;font-size:15px;">— The Rocking team</p>
</div>`;
}

async function recipients() {
  const [profiles, clients, people] = await Promise.all([
    get("profiles?select=email,role,status,client_id,person_id"),
    get("clients?select=id,name,status"),
    get("people?select=id,first_name"),
  ]);
  const cmap = new Map(clients.map((c) => [c.id, c]));
  const pmap = new Map(people.map((p) => [p.id, p.first_name]));
  return profiles
    .filter(
      (p) =>
        p.role !== "rocking_staff" &&
        p.status === "active" &&
        p.client_id &&
        cmap.get(p.client_id)?.status === "active",
    )
    .map((p) => ({
      email: p.email,
      clientId: p.client_id,
      clientName: cmap.get(p.client_id).name,
      name: greetingName(p.person_id ? pmap.get(p.person_id) : null),
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName));
}

async function sendOne(r) {
  const body = html(r.name);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [r.email],
      subject: SUBJECT,
      html: body,
      reply_to: REPLY_TO,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message ?? `HTTP ${res.status}`);
  // Record it the way lib/email/send.ts would, so the portal history is complete.
  await fetch(`${SB}/rest/v1/sent_emails`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      client_id: r.clientId,
      to_emails: [r.email],
      subject: SUBJECT,
      html: body,
      category: "announcement",
      audience: "client",
      resend_id: json?.id ?? null,
    }),
  });
  return json?.id ?? null;
}

const all = await recipients();
const list = only ? all.filter((r) => r.email === only) : all;

if (only && list.length === 0) {
  console.error(`No active recipient matches ${only}.`);
  process.exit(1);
}

console.log(`${all.length} eligible recipients across ${new Set(all.map((r) => r.clientName)).size} companies.`);
console.log(`${all.filter((r) => r.name).length} greeted by name, ${all.filter((r) => !r.name).length} with "Hi there".\n`);

if (dryRun) {
  for (const r of list) {
    console.log(`  ${(r.name ?? "Hi there").padEnd(14)} ${r.email.padEnd(42)} ${r.clientName}`);
  }
  console.log(`\nDRY RUN — nothing sent.`);
  process.exit(0);
}

console.log(`Sending to ${list.length}…\n`);
let sent = 0;
const failed = [];
for (const r of list) {
  try {
    await sendOne(r);
    sent++;
    console.log(`  ✓ ${r.email}`);
  } catch (e) {
    failed.push({ email: r.email, error: String(e.message ?? e) });
    console.log(`  ✗ ${r.email} — ${e.message ?? e}`);
  }
  // Stay well inside Resend's rate limit.
  await new Promise((res) => setTimeout(res, 600));
}

console.log(`\nSent ${sent}/${list.length}.`);
if (failed.length) {
  console.log(`Failed ${failed.length}:`);
  for (const f of failed) console.log(`  ${f.email} — ${f.error}`);
}
