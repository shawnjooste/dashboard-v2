/** The whole onboarding decision, as one pure function. No I/O, no clock of
 *  its own, no Supabase import — so every branch is provable in vitest. */
import { canAccess, type Overrides } from "../feature-access";
import { CATALOGUE } from "./catalogue";

/** Days a person must go without a step email before the next one. */
export const MIN_DAYS_BETWEEN_SENDS = 4;

/** `suppressed` is decided by the caller, which knows the opt-out state. */
export type StepDecision = {
  stepKey: string;
  outcome: "sent" | "skipped_already_using";
};

export type SequenceInput = {
  now: Date;
  enrolledAt: Date;
  role: string;
  overrides: Overrides;
  /** step_keys already in onboarding_sequence_sends for this person. */
  settled: Set<string>;
  /** decided_at of their most recent 'sent' row, or null. */
  lastSentAt: Date | null;
  /** Distinct portal_activity sections this person has visited. */
  visitedSections: Set<string>;
  hasDevices: boolean;
  hasXero: boolean;
};

const daysBetween = (from: Date, to: Date) =>
  (to.getTime() - from.getTime()) / 86_400_000;

/** Any number of `skipped_already_using` decisions, and at most one `sent`,
 *  which is always last. Empty when nothing is due.
 *
 *  A step failing its feature or data gate is deliberately NOT returned: it is
 *  "not eligible yet", not a decision, so no row is written and it becomes
 *  eligible again the moment the gate opens. That is what makes a feature
 *  granted months later still fire. */
export function dueSteps(input: SequenceInput): StepDecision[] {
  const decisions: StepDecision[] = [];
  const age = daysBetween(input.enrolledAt, input.now);
  const gapOk =
    input.lastSentAt === null ||
    daysBetween(input.lastSentAt, input.now) >= MIN_DAYS_BETWEEN_SENDS;

  for (const step of CATALOGUE) {
    if (input.settled.has(step.key)) continue;
    if (age < step.minDays) continue;
    if (step.feature && !canAccess(input.role, input.overrides, step.feature)) continue;
    if (step.dataGate === "devices" && !input.hasDevices) continue;
    if (step.dataGate === "xero" && !input.hasXero) continue;

    // Already using it: settle for free and keep walking — skips cost nothing
    // and an established enrolee should settle them all in one pass.
    if (step.sections.some((s) => input.visitedSections.has(s))) {
      decisions.push({ stepKey: step.key, outcome: "skipped_already_using" });
      continue;
    }

    // The first step that would actually send ends the walk either way. If the
    // pacing gap has not passed we send nothing rather than letting a later
    // step jump the queue.
    if (gapOk) decisions.push({ stepKey: step.key, outcome: "sent" });
    return decisions;
  }
  return decisions;
}
