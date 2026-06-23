import { describe, it, expect } from "vitest";
import { rfqDisplayName, rfqCardTag } from "./rfq-helpers";

describe("rfqDisplayName", () => {
  it("prefers the linked client name", () => {
    expect(rfqDisplayName("GSR Law", "ignored")).toBe("GSR Law");
  });
  it("falls back to the prospect name", () => {
    expect(rfqDisplayName(null, "New Prospect")).toBe("New Prospect");
  });
  it("shows an em-dash when neither is set", () => {
    expect(rfqDisplayName(null, null)).toBe("—");
  });
});

describe("rfqCardTag", () => {
  it("tags the sourcing note while sourcing", () => {
    expect(rfqCardTag("sourcing", "awaiting Jurumani", null)).toEqual({ text: "awaiting Jurumani", tone: "warn" });
  });
  it("tags the quote number when quoted", () => {
    expect(rfqCardTag("quoted", null, "QU-CFS-003")).toEqual({ text: "QU-CFS-003", tone: "info" });
  });
  it("tags the quote number green when won", () => {
    expect(rfqCardTag("won", null, "QU-CFS-003")).toEqual({ text: "QU-CFS-003", tone: "good" });
  });
  it("has no tag for a new RFQ", () => {
    expect(rfqCardTag("new", null, null)).toBeNull();
  });
  it("has no sourcing tag without a note", () => {
    expect(rfqCardTag("sourcing", null, null)).toBeNull();
  });
});
