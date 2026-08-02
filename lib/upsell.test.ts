import { describe, expect, it } from "vitest";
import { HEAVY_USER_THRESHOLD, heavyFreeUsers, isHeavyFreeUser, upsellLine } from "./upsell";

describe("isHeavyFreeUser", () => {
  it("is false below the threshold", () => {
    expect(isHeavyFreeUser(HEAVY_USER_THRESHOLD - 1)).toBe(false);
  });
  it("is true at the threshold", () => {
    expect(isHeavyFreeUser(HEAVY_USER_THRESHOLD)).toBe(true);
  });
});

describe("upsellLine", () => {
  it("stays gentle for light use", () => {
    const line = upsellLine(1);
    expect(line).toContain("as capacity allows");
    expect(line).not.toContain("1 tickets");
  });
  it("names the number once they're leaning on us", () => {
    expect(upsellLine(7)).toContain("7 tickets this month");
  });
  it("never scolds", () => {
    for (const n of [0, 5, 50]) {
      expect(upsellLine(n).toLowerCase()).not.toMatch(/too many|excessive|limit|abuse/);
    }
  });
});

describe("heavyFreeUsers", () => {
  const rows = [
    { clientName: "Busy Free Co", onPaidTier: false, tickets: 9 },
    { clientName: "Quiet Free Co", onPaidTier: false, tickets: 2 },
    { clientName: "Care Client", onPaidTier: true, tickets: 30 },
    { clientName: null, onPaidTier: false, tickets: 20 },
    { clientName: "Also Busy", onPaidTier: false, tickets: 6 },
  ];
  it("lists only free clients over the threshold, busiest first", () => {
    expect(heavyFreeUsers(rows).map((r) => r.clientName)).toEqual(["Busy Free Co", "Also Busy"]);
  });
  it("ignores paying clients no matter the volume", () => {
    expect(heavyFreeUsers(rows).some((r) => r.clientName === "Care Client")).toBe(false);
  });
  it("ignores tickets with no client (backups, cron, suppliers)", () => {
    expect(heavyFreeUsers(rows)).toHaveLength(2);
  });
});
