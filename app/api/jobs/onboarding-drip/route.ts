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

/**
 * Daily onboarding drip.
 *
 * Walks everyone enrolled, asks the pure `dueSteps` what each is owed, and
 * settles it. Only settled outcomes are written: a step failing its feature or
 * data gate gets no row, so it fires later if that feature is switched on.
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
    fetchAll<{
      id: string; email: string; role: string; status: string; client_id: string | null;
      feature_overrides: unknown; portal_updates_opt_out: boolean;
      people: { display_name: string | null } | { display_name: string | null }[] | null;
    }>((f, t) =>
      service
        .from("profiles")
        .select("id, email, role, status, client_id, feature_overrides, portal_updates_opt_out, people(display_name)")
        .in("id", ids)
        .order("id")
        .range(f, t),
    ),
    fetchAll<{ profile_id: string; step_key: string; outcome: string; decided_at: string }>((f, t) =>
      service
        .from("onboarding_sequence_sends")
        .select("profile_id, step_key, outcome, decided_at")
        .in("profile_id", ids)
        .order("profile_id")
        .range(f, t),
    ),
    fetchAll<{ profile_id: string | null; section: string }>((f, t) =>
      service
        .from("portal_activity")
        .select("profile_id, section")
        .in("profile_id", ids)
        .in("section", [...new Set(CATALOGUE.flatMap((s) => s.sections))])
        .order("profile_id")
        .range(f, t),
    ),
    fetchAll<{ id: string; name: string; xero_contact_id: string | null }>((f, t) =>
      service.from("clients").select("id, name, xero_contact_id").order("id").range(f, t),
    ),
    fetchAll<{ client_id: string }>((f, t) =>
      service.from("devices").select("client_id").order("client_id").range(f, t),
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

  const rows: { profile_id: string; step_key: string; outcome: string }[] = [];
  const preview: { email: string; step: string; outcome: string }[] = [];
  const stopped: string[] = [];
  let sent = 0;
  let capped = false;

  for (const s of state) {
    const p = profileById.get(s.profile_id);
    // Deactivated or deleted since enrolment — stop, don't email.
    if (!p || p.status !== "active") {
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
        rows.push({ profile_id: p.id, step_key: d.stepKey, outcome: d.outcome });
        preview.push({ email: p.email, step: d.stepKey, outcome: d.outcome });
        continue;
      }
      // outcome === "sent"
      if (p.portal_updates_opt_out) {
        // Record it so their sequence advances instead of stalling here
        // forever. sendEmail would suppress it anyway; not calling is cleaner.
        rows.push({ profile_id: p.id, step_key: d.stepKey, outcome: "suppressed" });
        preview.push({ email: p.email, step: d.stepKey, outcome: "suppressed" });
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
        await sendEmail({
          to: [p.email],
          subject: step.subject,
          html,
          category: "onboarding_step",
          audience: "client",
          clientId: p.client_id,
        });
        rows.push({ profile_id: p.id, step_key: d.stepKey, outcome: "sent" });
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

  if (rows.length) {
    const { error } = await service.from("onboarding_sequence_sends").insert(rows);
    if (error) console.error("onboarding drip: recording decisions failed", error.message);
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
    settled: rows.length - sent,
    stopped: stopped.length,
    capped,
  });
}

export const GET = runDrip;
export const POST = runDrip;
