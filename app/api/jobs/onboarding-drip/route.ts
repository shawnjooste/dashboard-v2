import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { toOverrides } from "@/lib/feature-access";
import { CATALOGUE } from "@/lib/onboarding/catalogue";
import { dueSteps } from "@/lib/onboarding/sequence";
import { stepEmailHtml } from "@/lib/onboarding/step-content";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";
const SUPPORT_EMAIL = "support@rocking.co.za"; // FreeScout helpdesk inbox — replies land as tickets
const ADMIN_EMAIL = "shawn@rocking.one";

/** A bug here emails hundreds of real customers, so a run can never exceed
 *  this many sends. Hitting it is logged loudly rather than silently truncated. */
const MAX_SENDS_PER_RUN = 200;

/** Vercel's default is 10s; a fully sequential loop of up to
 *  MAX_SENDS_PER_RUN sequential sends easily exceeds that. */
export const maxDuration = 300;

/** Only client-facing roles are ever due an onboarding email. `canAccess`
 *  treats "rocking_staff" as able to see every feature, so a staff profile
 *  that was ever enrolled (e.g. before a role change) would otherwise be
 *  mailed "your company" copy that was never meant for them. */
const CLIENT_ROLES = new Set(["client_manager", "client_member"]);

/** Page through a table — PostgREST silently caps unbounded selects at ~1000
 *  rows, which would look like "these people have never visited anything". */
async function fetchAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// 150 UUIDs × ~37 bytes ≈ 5.5 KB of query string — real headroom under the
// common 8 KB nginx/Kong request-line buffer this chunking exists to stay
// under. 250 (~9.3 KB) was already over that limit.
const ID_CHUNK = 150;
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** `.in()` filters land in the request's query string (~37 bytes/UUID) — a
 *  few hundred enrollee ids can exceed the proxy's request-line limit and
 *  fail the select outright. Chunk the id list, page each chunk, concatenate.
 *  Response paging (`fetchAll`) and request paging (this) are separate
 *  problems and both must be handled. */
async function fetchAllForIds<T>(
  ids: string[],
  run: (idChunk: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (const idChunk of chunk(ids, ID_CHUNK)) {
    out.push(...(await fetchAll<T>((f, t) => run(idChunk, f, t))));
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRIES = 2;
const RETRY_DELAY_MS = 500;
/** Postgres' unique-violation code (supabase-js surfaces it on `error.code`).
 *  A duplicate key on (profile_id, step_key) means the row already exists —
 *  the step IS settled, which is the outcome the insert was trying to
 *  produce. Self-healing, not actionable: never retry it, never alert on it. */
const PG_UNIQUE_VIOLATION = "23505";
/** Once this many decisions in a row have exhausted their retries, stop
 *  retrying for the rest of the run — the database is clearly not coming
 *  back within this invocation, and paying the full retry tax (3 inserts +
 *  1s of sleep each) on every remaining decision risks blowing `maxDuration`
 *  and re-triggering the exact duplicate-send bug retries exist to prevent. */
const CONSECUTIVE_FAILURE_THRESHOLD = 5;

/** Threaded through every `recordDecision` call in a run: tracks consecutive
 *  exhausted-retry failures (to trip the backoff above) and collects every
 *  failure for a single end-of-run alert, instead of one email per row. */
type DripRunState = {
  consecutiveFailures: number;
  failedDecisions: { profile_id: string; step_key: string; outcome: string; error: string }[];
};

/** Alerts an admin once per run when one or more decision rows could not be
 *  written even after retries. This is the one case that causes a duplicate
 *  send: with no row written, the affected steps read as unsettled AND
 *  `lastSentAt` is unchanged, so tomorrow's run sends the identical emails
 *  again. Capped at one email regardless of how many decisions failed — a
 *  systemic write failure (e.g. an overlapping run hitting duplicate keys
 *  everywhere, or a saturated pooler) must not become an alert storm.
 *  Wrapped so a failing alert can never break the run. */
async function alertRecordDecisionsFailed(
  failures: DripRunState["failedDecisions"],
): Promise<void> {
  const SHOWN = 25;
  const rows = failures
    .slice(0, SHOWN)
    .map(
      (f) => `<tr>
          <td style="color:#888; padding-right:12px;">${f.profile_id}</td>
          <td style="color:#888; padding-right:12px;">${f.step_key}</td>
          <td style="color:#888; padding-right:12px;">${f.outcome}</td>
          <td>${f.error}</td>
        </tr>`,
    )
    .join("");
  const more = failures.length > SHOWN ? `<p style="color:#888; margin:12px 0 0;">…and ${failures.length - SHOWN} more.</p>` : "";
  try {
    await sendEmail({
      category: "admin_alert",
      audience: "internal",
      to: [ADMIN_EMAIL],
      subject: `Onboarding drip: ${failures.length} decision${failures.length === 1 ? "" : "s"} failed to record`,
      html: `
        <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 640px;">
          <h2 style="margin:0 0 8px;">Onboarding drip: ${failures.length} decision${failures.length === 1 ? "" : "s"} failed to record</h2>
          <p style="color:#444; margin:0 0 16px;">
            These inserts into onboarding_sequence_sends failed after retries. Each affected step
            will read as unsettled tomorrow and lastSentAt won't have moved either, so the
            identical email is likely to go out again — this needs a human look.
          </p>
          <table style="font-size:14px; color:#111; border-collapse:collapse;">
            <tr style="text-align:left;"><th>Profile ID</th><th>Step key</th><th>Outcome</th><th>Error</th></tr>
            ${rows}
          </table>
          ${more}
        </div>`,
    });
  } catch (e) {
    console.error("onboarding drip: admin alert for failed decision inserts also failed", e);
  }
}

/** Writes one settled decision immediately, retrying transient failures a
 *  couple of times before giving up — unless the run has already seen
 *  `CONSECUTIVE_FAILURE_THRESHOLD` exhausted failures in a row, in which case
 *  this call gets a single attempt so the loop stays cheap. A duplicate-key
 *  violation is treated as success (see PG_UNIQUE_VIOLATION doc) and never
 *  retried. Any other exhausted failure is logged and queued onto
 *  `state.failedDecisions` for one end-of-run alert, rather than thrown, so
 *  it costs only this one row, not the rest of the run — see the module doc
 *  for why a bulk end-of-run insert is the wrong shape. */
async function recordDecision(
  service: ReturnType<typeof createServiceClient>,
  row: { profile_id: string; step_key: string; outcome: string },
  state: DripRunState,
): Promise<void> {
  const retriesAllowed = state.consecutiveFailures < CONSECUTIVE_FAILURE_THRESHOLD;
  const maxAttempts = retriesAllowed ? RETRIES + 1 : 1;
  let lastMessage = "";
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { error } = await service.from("onboarding_sequence_sends").insert(row);
    if (!error) {
      state.consecutiveFailures = 0;
      return;
    }
    if (error.code === PG_UNIQUE_VIOLATION) {
      // The row already exists — the step is already settled. Not a
      // database-health signal either way, so leave consecutiveFailures alone.
      console.error("onboarding drip: decision already recorded (duplicate key) — treating as settled", row.profile_id, row.step_key);
      return;
    }
    lastMessage = error.message;
    console.error(
      "onboarding drip: recording decision failed",
      row.profile_id,
      row.step_key,
      `(attempt ${attempt + 1}/${maxAttempts})`,
      error.message,
    );
    if (attempt < maxAttempts - 1) await sleep(RETRY_DELAY_MS);
  }
  state.consecutiveFailures++;
  state.failedDecisions.push({ ...row, error: lastMessage });
}

/**
 * Daily onboarding drip.
 *
 * Walks everyone enrolled, asks the pure `dueSteps` what each is owed, and
 * settles it. Only settled outcomes are written: a step failing its feature or
 * data gate gets no row, so it fires later if that feature is switched on.
 *
 * Each decision is written to the database the moment it's settled, not
 * batched into one insert at the end of the run. A single multi-row insert is
 * one statement — one bad row (a duplicate key, an FK violation from a
 * profile deleted mid-run) would abort every row in the batch, and the route
 * still returns 200. Settling per-decision means a failure costs one row, not
 * the whole day's run, and the run is self-healing either way: an unwritten
 * row is picked up again tomorrow.
 *
 * Service-role (a scheduled run has no signed-in user), guarded by the same
 * CRON_SECRET bearer as the other jobs, exported as GET and POST so the
 * scheduled and manual paths cannot diverge.
 *
 * `?dry=1` reports exactly what would happen and writes nothing.
 */
async function runDrip(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET not set — refusing to run the onboarding drip");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.RESEND_API_KEY) {
    // sendEmail() itself only warns and returns a null id when the key is
    // missing — it does not throw. Left unguarded here, every due step in
    // the run would be recorded as "sent" while nothing was actually mailed,
    // permanently burying those steps. Refuse the whole run instead.
    console.error("RESEND_API_KEY not set — refusing to run the onboarding drip");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1";
  const service = createServiceClient();
  const now = new Date();

  const state = await fetchAll<{ profile_id: string; enrolled_at: string }>((f, t) =>
    service
      .from("onboarding_sequence_state")
      .select("profile_id, enrolled_at")
      .eq("status", "active")
      .order("profile_id")
      .range(f, t),
  );
  if (state.length === 0) {
    // Honour `dry` here too — Task 7's dry-run script reads wouldSend /
    // wouldSettle / wouldStop / capped / decisions, and an empty portal
    // (the state this route is first run against) is exactly when this
    // early return fires.
    if (dry) {
      return NextResponse.json({
        dryRun: true,
        enrolled: 0,
        wouldSend: 0,
        wouldSettle: 0,
        wouldStop: 0,
        capped: false,
        decisions: [],
      });
    }
    return NextResponse.json({ enrolled: 0, sent: 0, settled: 0, stopped: 0, capped: false });
  }

  const ids = state.map((s) => s.profile_id);

  const [profiles, sends, activity, clients, devices] = await Promise.all([
    fetchAllForIds<{
      id: string; email: string; role: string; status: string; client_id: string | null;
      feature_overrides: unknown; portal_updates_opt_out: boolean;
      people: { display_name: string | null } | { display_name: string | null }[] | null;
    }>(ids, (idChunk, f, t) =>
      service
        .from("profiles")
        .select("id, email, role, status, client_id, feature_overrides, portal_updates_opt_out, people(display_name)")
        .in("id", idChunk)
        .order("id")
        .range(f, t),
    ),
    // profile_id alone is not a unique key here — up to one row per
    // (profile_id, step_key) — so a tiebreaker is required for range() paging
    // to be stable. Without it a row can be skipped between pages, which
    // reads as "this step was never settled" and re-sends an email the
    // customer already received.
    fetchAllForIds<{ profile_id: string; step_key: string; outcome: string; decided_at: string }>(ids, (idChunk, f, t) =>
      service
        .from("onboarding_sequence_sends")
        .select("profile_id, step_key, outcome, decided_at")
        .in("profile_id", idChunk)
        .order("profile_id")
        .order("step_key")
        .range(f, t),
    ),
    // Same reasoning: many portal_activity rows share a profile_id (one per
    // kind/section/hour-bucket), so pair the order with the uuid PK.
    fetchAllForIds<{ profile_id: string | null; section: string }>(ids, (idChunk, f, t) =>
      service
        .from("portal_activity")
        .select("profile_id, section, id")
        .in("profile_id", idChunk)
        .in("section", [...new Set(CATALOGUE.flatMap((s) => s.sections))])
        .order("profile_id")
        .order("id")
        .range(f, t),
    ),
    // Unfiltered by enrollee ids (small table, no request-size concern) —
    // ordered by primary key, so no tiebreaker instability here.
    fetchAll<{ id: string; name: string; xero_contact_id: string | null }>((f, t) =>
      service.from("clients").select("id, name, xero_contact_id").order("id").range(f, t),
    ),
    // Many devices share a client_id — same tiebreaker reasoning as above.
    fetchAll<{ client_id: string }>((f, t) =>
      service.from("devices").select("client_id, id").order("client_id").order("id").range(f, t),
    ),
  ]);

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const clientsWithDevices = new Set(devices.map((d) => d.client_id));

  const settledBy = new Map<string, Set<string>>();
  const lastSentBy = new Map<string, Date>();
  for (const s of sends) {
    if (!settledBy.has(s.profile_id)) settledBy.set(s.profile_id, new Set());
    settledBy.get(s.profile_id)!.add(s.step_key);
    if (s.outcome === "sent") {
      const at = new Date(s.decided_at);
      const prev = lastSentBy.get(s.profile_id);
      if (!prev || at > prev) lastSentBy.set(s.profile_id, at);
    }
  }

  const visitedBy = new Map<string, Set<string>>();
  for (const a of activity) {
    if (!a.profile_id) continue;
    if (!visitedBy.has(a.profile_id)) visitedBy.set(a.profile_id, new Set());
    visitedBy.get(a.profile_id)!.add(a.section);
  }

  const preview: { email: string; step: string; outcome: string }[] = [];
  const stopped: string[] = [];
  let sent = 0;
  let settled = 0;
  let capped = false;
  const dripState: DripRunState = { consecutiveFailures: 0, failedDecisions: [] };

  for (const s of state) {
    const p = profileById.get(s.profile_id);
    // Deactivated/deleted since enrolment, or not a client role (a staff
    // profile should never receive "your company" onboarding copy) — stop,
    // don't email.
    if (!p || p.status !== "active" || !CLIENT_ROLES.has(p.role)) {
      stopped.push(s.profile_id);
      continue;
    }
    const client = p.client_id ? clientById.get(p.client_id) : null;
    const decisions = dueSteps({
      now,
      enrolledAt: new Date(s.enrolled_at),
      role: p.role,
      overrides: toOverrides(p.feature_overrides ?? null),
      settled: settledBy.get(p.id) ?? new Set(),
      lastSentAt: lastSentBy.get(p.id) ?? null,
      visitedSections: visitedBy.get(p.id) ?? new Set(),
      hasDevices: !!p.client_id && clientsWithDevices.has(p.client_id),
      hasXero: !!client?.xero_contact_id,
    });

    for (const d of decisions) {
      if (d.outcome === "skipped_already_using") {
        preview.push({ email: p.email, step: d.stepKey, outcome: d.outcome });
        if (!dry) await recordDecision(service, { profile_id: p.id, step_key: d.stepKey, outcome: d.outcome }, dripState);
        settled++;
        continue;
      }
      // outcome === "sent"
      if (p.portal_updates_opt_out) {
        // Record it so their sequence advances instead of stalling here
        // forever. sendEmail would suppress it anyway; not calling is cleaner.
        preview.push({ email: p.email, step: d.stepKey, outcome: "suppressed" });
        if (!dry) await recordDecision(service, { profile_id: p.id, step_key: d.stepKey, outcome: "suppressed" }, dripState);
        settled++;
        continue;
      }
      if (sent >= MAX_SENDS_PER_RUN) {
        capped = true;
        continue;
      }
      preview.push({ email: p.email, step: d.stepKey, outcome: "sent" });
      if (dry) {
        sent++;
        continue;
      }
      const step = CATALOGUE.find((c) => c.key === d.stepKey)!;
      const person = Array.isArray(p.people) ? p.people[0] : p.people;
      // Matches the welcome email's handling (app/(admin)/admin/users/actions.ts):
      // display_name's first word when present, otherwise the email's local
      // part — never the whole email, which splitting on a space would return
      // since an address has no space in it.
      const displayName = person?.display_name ?? null;
      const firstName = (displayName ? displayName.split(/\s+/)[0] : p.email.split("@")[0]) || "there";
      const html = stepEmailHtml(d.stepKey, {
        firstName,
        companyName: client?.name ?? "your company",
        portalUrl: `${APP_URL}/${d.stepKey}`,
      });
      if (!html) {
        console.error("onboarding drip: no copy for step", d.stepKey);
        continue;
      }
      try {
        const result = await sendEmail({
          to: [p.email],
          subject: step.subject,
          html,
          category: "onboarding_step",
          audience: "client",
          clientId: p.client_id,
          // The template's default support copy tells the reader to reply —
          // route that reply into the FreeScout helpdesk inbox instead of
          // DEFAULT_FROM (no-reply@), which cannot receive mail at all.
          replyTo: SUPPORT_EMAIL,
        });
        // sendEmail throws on any non-2xx Resend response (lib/email/send.ts:88),
        // so reaching this line means the mail was accepted for delivery —
        // a null `id` here is NOT "nothing was sent". The only genuine
        // no-send path is every recipient being suppressed (opted out,
        // possibly a race against our profiles read from earlier in this
        // run); that's the one case with a non-empty `suppressed` array.
        if (result.suppressed.length > 0) {
          await recordDecision(service, { profile_id: p.id, step_key: d.stepKey, outcome: "suppressed" }, dripState);
          settled++;
          continue;
        }
        if (result.id === null) {
          // Delivered, but Resend's response body didn't parse into the
          // expected shape — worth knowing about, but the mail is already
          // gone, so the row is still written as sent. Treating this as
          // not-sent would re-mail everyone on the run's send path daily.
          console.error("onboarding drip: sendEmail returned a null id (delivered; response body didn't parse) for", p.email, d.stepKey);
        }
        // Row written only after the send resolved — an unsent step (the
        // catch block below) must stay eligible for tomorrow's run.
        await recordDecision(service, { profile_id: p.id, step_key: d.stepKey, outcome: "sent" }, dripState);
        sent++;
      } catch (e) {
        // No row: an unsent step must stay eligible for tomorrow's run.
        console.error("onboarding drip: send failed for", p.email, d.stepKey, e);
      }
    }
  }

  if (capped) {
    console.error(`onboarding drip: hit the ${MAX_SENDS_PER_RUN}-send cap — some steps deferred`);
  }

  // One alert for the whole run, never one per row — see alertRecordDecisionsFailed's doc.
  if (dripState.failedDecisions.length > 0) {
    await alertRecordDecisionsFailed(dripState.failedDecisions);
  }

  if (dry) {
    return NextResponse.json({
      dryRun: true,
      enrolled: state.length,
      wouldSend: preview.filter((p) => p.outcome === "sent").length,
      wouldSettle: preview.filter((p) => p.outcome !== "sent").length,
      wouldStop: stopped.length,
      capped,
      decisions: preview.slice(0, 100),
    });
  }

  // Chunked for the same reason the reads above are: round 1's role gate
  // means every staff enrollee lands in `stopped` too, so this list scales
  // with total enrollment, not just recent deactivations, and an unbounded
  // `.in()` can exceed the proxy's request-line limit.
  for (const idChunk of chunk(stopped, ID_CHUNK)) {
    const { error } = await service
      .from("onboarding_sequence_state")
      .update({ status: "stopped" })
      .in("profile_id", idChunk);
    if (error) console.error("onboarding drip: stopping sequences failed", error.message);
  }

  return NextResponse.json({
    enrolled: state.length,
    sent,
    settled,
    stopped: stopped.length,
    capped,
  });
}

export const GET = runDrip;
export const POST = runDrip;
