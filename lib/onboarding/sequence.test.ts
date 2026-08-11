import { describe, it, expect } from "vitest";
import { dueSteps, MIN_DAYS_BETWEEN_SENDS, type SequenceInput } from "./sequence";

const DAY = 86_400_000;
const NOW = new Date("2026-08-11T07:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

/** A manager, 30 days in, using nothing, with every data gate satisfied. */
function input(over: Partial<SequenceInput> = {}): SequenceInput {
  return {
    now: NOW,
    enrolledAt: daysAgo(30),
    role: "client_manager",
    overrides: null,
    settled: new Set<string>(),
    lastSentAt: null,
    visitedSections: new Set<string>(),
    hasDevices: true,
    hasXero: true,
    ...over,
  };
}

describe("dueSteps", () => {
  it("sends nothing before the first floor", () => {
    expect(dueSteps(input({ enrolledAt: daysAgo(2) }))).toEqual([]);
  });

  it("offers the first due step", () => {
    expect(dueSteps(input({ enrolledAt: daysAgo(3) }))).toEqual([
      { stepKey: "support", outcome: "sent" },
    ]);
  });

  it("never returns more than one send", () => {
    const sends = dueSteps(input()).filter((d) => d.outcome === "sent");
    expect(sends).toHaveLength(1);
  });

  it("puts the send last", () => {
    const decisions = dueSteps(input({ visitedSections: new Set(["support"]) }));
    expect(decisions[decisions.length - 1].outcome).toBe("sent");
  });

  it("settles a step the person already uses", () => {
    expect(dueSteps(input({ visitedSections: new Set(["support"]) }))).toEqual([
      { stepKey: "support", outcome: "skipped_already_using" },
      { stepKey: "devices", outcome: "sent" },
    ]);
  });

  it("counts a single device page as using devices", () => {
    const decisions = dueSteps(
      input({ visitedSections: new Set(["support", "device"]) }),
    );
    expect(decisions).toContainEqual({
      stepKey: "devices",
      outcome: "skipped_already_using",
    });
  });

  it("settles every skip in one pass, not one per run", () => {
    const decisions = dueSteps(
      input({ visitedSections: new Set(["support", "devices", "billing"]) }),
    );
    expect(decisions.filter((d) => d.outcome === "skipped_already_using")).toHaveLength(3);
    expect(decisions[3]).toEqual({ stepKey: "connectivity", outcome: "sent" });
  });

  it("leaves NO decision for a failed feature gate, so it stays eligible", () => {
    // Devices switched off: the step is passed over silently, no row written,
    // so it fires later if devices is switched back on.
    const decisions = dueSteps(
      input({
        overrides: { devices: false },
        visitedSections: new Set(["support"]),
      }),
    );
    expect(decisions.map((d) => d.stepKey)).not.toContain("devices");
    expect(decisions).toEqual([
      { stepKey: "support", outcome: "skipped_already_using" },
      { stepKey: "billing", outcome: "sent" },
    ]);
  });

  it("leaves NO decision for a failed data gate, so it stays eligible", () => {
    const decisions = dueSteps(
      input({ hasDevices: false, visitedSections: new Set(["support"]) }),
    );
    expect(decisions.map((d) => d.stepKey)).not.toContain("devices");
    expect(decisions).toEqual([
      { stepKey: "support", outcome: "skipped_already_using" },
      { stepKey: "billing", outcome: "sent" },
    ]);
  });

  it("leaves NO decision for a failed xero data gate, so it stays eligible", () => {
    // No Xero connection: billing is passed over silently (not merely
    // skipped), so connectivity — the next step in the catalogue — is what
    // actually sends. `devices` is pre-settled (from an earlier run) purely
    // to get it out of the way, since it precedes billing in the catalogue
    // and would otherwise be the one that sends.
    const decisions = dueSteps(
      input({
        hasXero: false,
        settled: new Set(["devices"]),
        visitedSections: new Set(["support"]),
      }),
    );
    expect(decisions).toEqual([
      { stepKey: "support", outcome: "skipped_already_using" },
      { stepKey: "connectivity", outcome: "sent" },
    ]);
  });

  it("fires a step whose feature is granted long after enrolment", () => {
    // A year in, every other step settled, connectivity just switched on.
    const decisions = dueSteps(
      input({
        enrolledAt: daysAgo(365),
        settled: new Set(["support", "devices", "billing", "team"]),
      }),
    );
    expect(decisions).toEqual([{ stepKey: "connectivity", outcome: "sent" }]);
  });

  it("never reconsiders a settled step", () => {
    const decisions = dueSteps(input({ settled: new Set(["support"]) }));
    expect(decisions.map((d) => d.stepKey)).not.toContain("support");
  });

  it("holds the send until the gap has passed", () => {
    expect(dueSteps(input({ lastSentAt: daysAgo(3) }))).toEqual([]);
  });

  it("sends once the gap has passed", () => {
    expect(
      dueSteps(input({ lastSentAt: daysAgo(MIN_DAYS_BETWEEN_SENDS) })),
    ).toEqual([{ stepKey: "support", outcome: "sent" }]);
  });

  it("still settles skips while the gap holds the send back", () => {
    const decisions = dueSteps(
      input({ lastSentAt: daysAgo(1), visitedSections: new Set(["support"]) }),
    );
    expect(decisions).toEqual([
      { stepKey: "support", outcome: "skipped_already_using" },
    ]);
  });

  it("does not let a later step jump the queue while the gap holds", () => {
    // support is unvisited and gap-blocked, so the walk stops there: nothing
    // is settled, even though billing (later in the catalogue) is already
    // in use and would otherwise settle for free.
    const decisions = dueSteps(
      input({ lastSentAt: daysAgo(1), visitedSections: new Set(["billing"]) }),
    );
    expect(decisions).toEqual([]);
  });

  it("gives a member only the support step", () => {
    const decisions = dueSteps(input({ role: "client_member" }));
    expect(decisions).toEqual([{ stepKey: "support", outcome: "sent" }]);
  });

  it("returns nothing when every step is settled", () => {
    expect(
      dueSteps(
        input({
          settled: new Set(["support", "devices", "billing", "connectivity", "team"]),
        }),
      ),
    ).toEqual([]);
  });
});
