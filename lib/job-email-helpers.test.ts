import { describe, it, expect } from "vitest";
import { greetingName } from "./job-email-helpers";

describe("greetingName", () => {
  it("prefers the structured first name", () => {
    expect(greetingName({ first_name: "Monique", display_name: "Monique Siers" })).toBe("Monique");
  });
  it("falls back to the first token of the display name", () => {
    expect(greetingName({ first_name: null, display_name: "Sam Robertson" })).toBe("Sam");
  });
  it("uses a neutral greeting when no name is known", () => {
    expect(greetingName({ first_name: null, display_name: null })).toBe("there");
    expect(greetingName(null)).toBe("there");
  });
  it("ignores blank / whitespace-only names", () => {
    expect(greetingName({ first_name: "   ", display_name: "  Jane Doe " })).toBe("Jane");
  });
});
