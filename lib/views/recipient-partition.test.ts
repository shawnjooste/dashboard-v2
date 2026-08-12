import { describe, expect, it } from "vitest";
import { partitionRecipients, type PartitionRow } from "./recipient-partition";

const row = (over: Partial<PartitionRow> = {}): PartitionRow => ({
  email: "a@x.com",
  name: "A",
  clientName: "Acme",
  clientId: "c1",
  role: "client_manager",
  overrides: null,
  optedOut: false,
  ...over,
});

describe("partitionRecipients", () => {
  it("puts a plain manager in eligible when there is no filter", () => {
    const out = partitionRecipients([row()]);
    expect(out.eligible.map((r) => r.email)).toEqual(["a@x.com"]);
    expect(out.optedOut).toEqual([]);
    expect(out.excluded).toEqual([]);
  });

  it("moves an opted-out person out of eligible", () => {
    const out = partitionRecipients([row({ optedOut: true })]);
    expect(out.eligible).toEqual([]);
    expect(out.optedOut.map((r) => r.email)).toEqual(["a@x.com"]);
  });

  it("excludes a manager who has the feature switched off", () => {
    const out = partitionRecipients([row({ overrides: { connectivity: false } })], { feature: "connectivity" });
    expect(out.eligible).toEqual([]);
    expect(out.excluded).toEqual([
      { email: "a@x.com", name: "A", clientName: "Acme", reason: "no_feature" },
    ]);
  });

  it("excludes every member when a feature filter is set, since members default to none", () => {
    const out = partitionRecipients([row({ role: "client_member" })], { feature: "connectivity" });
    expect(out.eligible).toEqual([]);
    expect(out.excluded[0].reason).toBe("no_feature");
  });

  it("keeps a manager whose overrides remove a DIFFERENT feature", () => {
    const out = partitionRecipients([row({ overrides: { billing: false } })], { feature: "connectivity" });
    expect(out.eligible.map((r) => r.email)).toEqual(["a@x.com"]);
  });

  it("excludes clients without the service when clientIdsWithService is given", () => {
    const rows = [row({ email: "has@x.com", clientId: "c1" }), row({ email: "not@x.com", clientId: "c2" })];
    const out = partitionRecipients(rows, { clientIdsWithService: new Set(["c1"]) });
    expect(out.eligible.map((r) => r.email)).toEqual(["has@x.com"]);
    expect(out.excluded).toEqual([
      { email: "not@x.com", name: "A", clientName: "Acme", reason: "no_service" },
    ]);
  });

  it("treats a null clientId as not having the service", () => {
    const out = partitionRecipients([row({ clientId: null })], { clientIdsWithService: new Set(["c1"]) });
    expect(out.excluded[0].reason).toBe("no_service");
  });

  // Exclusion wins over opt-out: someone who cannot see the page was never in
  // the audience, so counting them as "opted out" would overstate refusals.
  it("reports someone who is both invisible and opted out as excluded, not optedOut", () => {
    const out = partitionRecipients([row({ overrides: { connectivity: false }, optedOut: true })], {
      feature: "connectivity",
    });
    expect(out.optedOut).toEqual([]);
    expect(out.excluded[0].reason).toBe("no_feature");
  });

  it("checks the feature before the service so the reason is the more specific one", () => {
    const out = partitionRecipients([row({ overrides: { connectivity: false }, clientId: "c2" })], {
      feature: "connectivity",
      clientIdsWithService: new Set(["c1"]),
    });
    expect(out.excluded[0].reason).toBe("no_feature");
  });

  it("sorts each bucket by client then name", () => {
    const rows = [
      row({ email: "z@x.com", name: "Zoe", clientName: "Beta" }),
      row({ email: "a@x.com", name: "Amy", clientName: "Beta" }),
      row({ email: "m@x.com", name: "Mo", clientName: "Alpha" }),
    ];
    const out = partitionRecipients(rows);
    expect(out.eligible.map((r) => r.email)).toEqual(["m@x.com", "a@x.com", "z@x.com"]);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ email: "b@x.com" }), row({ email: "a@x.com" })];
    const before = rows.map((r) => r.email);
    partitionRecipients(rows);
    expect(rows.map((r) => r.email)).toEqual(before);
  });
});
