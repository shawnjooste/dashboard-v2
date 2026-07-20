import { describe, expect, it } from "vitest";
import { FEATURES, allowedFeatures, canAccess, overridesFromSelection } from "./feature-access";

describe("canAccess", () => {
  it("staff always passes", () => {
    expect(canAccess("rocking_staff", { billing: false }, "billing")).toBe(true);
  });
  it("manager defaults to everything", () => {
    for (const f of FEATURES) expect(canAccess("client_manager", null, f)).toBe(true);
  });
  it("member defaults to nothing", () => {
    for (const f of FEATURES) expect(canAccess("client_member", null, f)).toBe(false);
  });
  it("an override subtracts from a manager", () => {
    expect(canAccess("client_manager", { billing: false }, "billing")).toBe(false);
    expect(canAccess("client_manager", { billing: false }, "quotes")).toBe(true);
  });
  it("unknown features are denied for clients", () => {
    expect(canAccess("client_manager", null, "nonsense")).toBe(false);
  });
});

describe("allowedFeatures", () => {
  it("reflects overrides", () => {
    const set = allowedFeatures("client_manager", { team: false });
    expect(set.has("team")).toBe(false);
    expect(set.has("billing")).toBe(true);
  });
});

describe("overridesFromSelection", () => {
  it("stores only unticked defaults", () => {
    const sel = new Set<string>(FEATURES.filter((f) => f !== "billing"));
    expect(overridesFromSelection("client_manager", sel)).toEqual({ billing: false });
  });
  it("all defaults → null", () => {
    expect(overridesFromSelection("client_manager", new Set(FEATURES))).toBeNull();
  });
  it("members always resolve to null in v1 (subtractive only)", () => {
    expect(overridesFromSelection("client_member", new Set())).toBeNull();
  });
});
