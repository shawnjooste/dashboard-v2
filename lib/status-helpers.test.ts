import { describe, expect, it } from "vitest";
import {
  dotColour, resolveRecipients, statusLabel, subjectFor, typeRank, worstType,
  type Subscriber,
} from "./status-helpers";

describe("typeRank / worstType", () => {
  it("ranks outage worst and maintenance least", () => {
    expect(typeRank("outage")).toBeLessThan(typeRank("degraded"));
    expect(typeRank("degraded")).toBeLessThan(typeRank("maintenance"));
    expect(typeRank("nonsense")).toBe(99);
  });
  it("picks the worst present type", () => {
    expect(worstType(["maintenance", "outage", "degraded"])).toBe("outage");
    expect(worstType(["maintenance", "degraded"])).toBe("degraded");
    expect(worstType(["maintenance"])).toBe("maintenance");
  });
  it("returns null when nothing is active", () => {
    expect(worstType([])).toBeNull();
  });
  it("ignores unknown types rather than ranking them worst", () => {
    expect(worstType(["nonsense", "degraded"])).toBe("degraded");
  });
});

describe("dotColour / statusLabel", () => {
  it("is green with nothing active", () => {
    expect(dotColour(null)).toBe("#15803D");
    expect(statusLabel(null)).toBe("All systems operational");
  });
  it("is red for an outage", () => {
    expect(dotColour("outage")).toBe("#B91C1C");
    expect(statusLabel("outage")).toContain("Outage");
  });
});

describe("subjectFor", () => {
  it("prefixes with the type while active", () => {
    expect(subjectFor("Fibre down at GSR", "outage", false)).toBe("[Outage] Fibre down at GSR");
    expect(subjectFor("Slow email", "degraded", false)).toBe("[Degraded] Slow email");
  });
  it("prefixes with Resolved once resolved, whatever the type", () => {
    expect(subjectFor("Fibre down at GSR", "outage", true)).toBe("[Resolved] Fibre down at GSR");
  });
});

describe("resolveRecipients", () => {
  const subs: Subscriber[] = [
    { profileId: "p1", email: "a@gsr.co.za", clientId: "gsr", role: "client_manager" },
    { profileId: "p2", email: "b@gsr.co.za", clientId: "gsr", role: "client_member" },
    { profileId: "p3", email: "c@other.co.za", clientId: "other", role: "client_manager" },
    { profileId: "p4", email: "staff@rocking.one", clientId: null, role: "rocking_staff" },
  ];

  it("global reaches every subscribed client user", () => {
    const out = resolveRecipients(subs, { scope: "global", clientIds: [] });
    expect(out.map((r) => r.profileId).sort()).toEqual(["p1", "p2", "p3"]);
  });
  it("never emails staff", () => {
    const out = resolveRecipients(subs, { scope: "global", clientIds: [] });
    expect(out.some((r) => r.role === "rocking_staff")).toBe(false);
  });
  it("client-scoped reaches only the targeted client", () => {
    const out = resolveRecipients(subs, { scope: "clients", clientIds: ["gsr"] });
    expect(out.map((r) => r.profileId).sort()).toEqual(["p1", "p2"]);
  });
  it("client-scoped with no targets reaches nobody", () => {
    expect(resolveRecipients(subs, { scope: "clients", clientIds: [] })).toEqual([]);
  });
  it("dedupes a profile listed twice", () => {
    const dupes = [...subs, subs[0]];
    const out = resolveRecipients(dupes, { scope: "clients", clientIds: ["gsr"] });
    expect(out.filter((r) => r.profileId === "p1")).toHaveLength(1);
  });
});
