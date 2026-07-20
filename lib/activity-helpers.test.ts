import { describe, expect, it } from "vitest";
import { groupByDay, isLoginGap, sectionFromPath } from "./activity-helpers";

describe("sectionFromPath", () => {
  it("maps the account home", () => {
    expect(sectionFromPath("/")).toBe("home");
  });
  it("maps list pages to their section", () => {
    expect(sectionFromPath("/billing")).toBe("billing");
    expect(sectionFromPath("/quotes")).toBe("quotes");
    expect(sectionFromPath("/support")).toBe("support");
  });
  it("maps a device detail page to 'device'", () => {
    expect(sectionFromPath("/devices/abc-123")).toBe("device");
  });
  it("keeps quote detail under 'quotes'", () => {
    expect(sectionFromPath("/quotes/abc-123")).toBe("quotes");
  });
  it("maps unknown paths to 'other'", () => {
    expect(sectionFromPath("/welcome")).toBe("other");
  });
  it("maps connectivity", () => {
    expect(sectionFromPath("/connectivity")).toBe("connectivity");
  });
});

describe("isLoginGap", () => {
  it("no prior activity is a login", () => {
    expect(isLoginGap(null)).toBe(true);
  });
  it("eight hours or more is a login", () => {
    expect(isLoginGap(480)).toBe(true);
  });
  it("recent activity is not a login", () => {
    expect(isLoginGap(90)).toBe(false);
  });
});

describe("groupByDay", () => {
  it("groups sorted items by calendar day", () => {
    const items = [
      { at: "2026-07-16T09:00:00Z", n: 1 },
      { at: "2026-07-16T07:00:00Z", n: 2 },
      { at: "2026-07-15T22:00:00Z", n: 3 },
    ];
    const groups = groupByDay(items);
    expect(groups.map((g) => g.day)).toEqual(["2026-07-16", "2026-07-15"]);
    expect(groups[0].items).toHaveLength(2);
  });
  it("handles empty input", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
