import { describe, expect, it } from "vitest";
import { categoryLabel, formatRecipients } from "./communications-helpers";

describe("categoryLabel", () => {
  it("labels known categories", () => {
    expect(categoryLabel("onboarding")).toBe("Welcome");
    expect(categoryLabel("quote")).toBe("Quote");
    expect(categoryLabel("job")).toBe("Job update");
  });
  it("falls back to the raw key for unknown categories", () => {
    expect(categoryLabel("something_new")).toBe("something_new");
  });
});

describe("formatRecipients", () => {
  it("joins a short list", () => {
    expect(formatRecipients(["a@x.com", "b@x.com"])).toBe("a@x.com, b@x.com");
  });
  it("truncates past three", () => {
    expect(formatRecipients(["a@x.com", "b@x.com", "c@x.com", "d@x.com", "e@x.com"])).toBe(
      "a@x.com, b@x.com, c@x.com +2 more",
    );
  });
  it("handles exactly three without truncating", () => {
    expect(formatRecipients(["a@x.com", "b@x.com", "c@x.com"])).toBe("a@x.com, b@x.com, c@x.com");
  });
  it("handles an empty list", () => {
    expect(formatRecipients([])).toBe("—");
  });
});
