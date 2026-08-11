import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendEmail } from "@/lib/email/send";
import { toOverrides } from "@/lib/feature-access";
import { CATALOGUE } from "@/lib/onboarding/catalogue";
import { dueSteps } from "@/lib/onboarding/sequence";
import { stepEmailHtml } from "@/lib/onboarding/step-content";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

/** A bug here emails hundreds of real customers, so a run can never exceed
 *  this many sends. Hitting it is logged loudly rather than silently truncated. */
const MAX_SENDS_PER_RUN = 200;

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

const ID_CHUNK = 250;
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

/** Writes one settled decision immediately. A failure here is logged and
 *  swallowed so it costs only this one row, not the rest of the run — see
 *  the module doc for why a bulk end-of-run insert is the wrong shape. */
async function recordDecision(
  service: ReturnType<typeof createServiceClient>,
  row: { profile_id: string; step_key: string; outcome: string },
): Promise<void> {
  const { error } = await service.from("onboarding_sequence_sends").insert(row);
  if (error) {
    console.error("onboarding drip: recording decision failed", row.profile_id, row.step_key, error.message);
  }
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
  if (state.length === 0) return NextResponse.json({ enrolled: 0, sent: 0, settled: 0 });

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
        if (!dry) await recordDecision(service, { profile_id: p.id, step_key: d.stepKey, outcome: d.outcome });
        settled++;
        continue;
      }
      // outcome === "sent"
      if (p.portal_updates_opt_out) {
        // Record it so their sequence advances instead of stalling here
        // forever. sendEmail would suppress it anyway; not calling is cleaner.
        preview.push({ email: p.email, step: d.stepKey, outcome: "suppressed" });
        if (!dry) await recordDecision(service, { profile_id: p.id, step_key: d.stepKey, outcome: "suppressed" });
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
      const firstName = (person?.display_name ?? p.email).split(" ")[0];
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
        });
        if (result.id === null) {
          // sendEmail didn't throw but also didn't send (missing API key —
          // already guarded above — or every recipient was suppressed at
          // the send layer). Either way nothing went out: no row, so this
          // step is still due tomorrow instead of being marked sent forever.
          console.error("onboarding drip: send did not go out for", p.email, d.stepKey);
          continue;
        }
        // Row written only after the send resolved with a real message id —
        // an unsent step must stay eligible for tomorrow's run.
        await recordDecision(service, { profile_id: p.id, step_key: d.stepKey, outcome: "sent" });
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

  if (stopped.length) {
    await service
      .from("onboarding_sequence_state")
      .update({ status: "stopped" })
      .in("profile_id", stopped);
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
