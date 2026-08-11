import { describe, it, expect } from "vitest";
import { CATALOGUE } from "./catalogue";
import { FEATURES } from "../feature-access";
import { SECTION_LABELS } from "../activity-helpers";

describe("CATALOGUE", () => {
  it("has unique step keys", () => {
    const keys = CATALOGUE.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("names only real features", () => {
    for (const step of CATALOGUE) {
      if (step.feature) expect(FEATURES).toContain(step.feature);
    }
  });

  it("names only real activity sections", () => {
    for (const step of CATALOGUE) {
      expect(step.sections.length).toBeGreaterThan(0);
      for (const section of step.sections) {
        expect(Object.keys(SECTION_LABELS)).toContain(section);
      }
    }
  });

  it("is ordered by ascending minDays", () => {
    const days = CATALOGUE.map((s) => s.minDays);
    expect([...days].sort((a, b) => a - b)).toEqual(days);
  });

  // /devices/<id> tracks as "device", the list as "devices". A step that
  // watched only one of them would miss someone who uses the other.
  it("treats both device sections as usage", () => {
    const devices = CATALOGUE.find((s) => s.key === "devices");
    expect(devices?.sections).toEqual(expect.arrayContaining(["devices", "device"]));
  });
});
