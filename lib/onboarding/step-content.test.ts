import { describe, it, expect } from "vitest";
import { stepEmailHtml } from "./step-content";
import { CATALOGUE } from "./catalogue";

const opts = {
  firstName: "Sam",
  companyName: "GSR",
  portalUrl: "https://portal.rocking.one/support",
};

describe("stepEmailHtml", () => {
  it("renders every catalogue step", () => {
    for (const step of CATALOGUE) {
      const html = stepEmailHtml(step.key, opts);
      expect(html, `missing copy for ${step.key}`).toBeTruthy();
      expect(html).toContain("Sam");
    }
  });

  it("returns null for an unknown step", () => {
    expect(stepEmailHtml("nope", opts)).toBeNull();
  });

  it("escapes the company name", () => {
    const html = stepEmailHtml("support", { ...opts, companyName: "A & B <script>" });
    expect(html).not.toContain("<script>");
  });

  // These land months later for someone granted a feature late, so they must
  // not pretend the reader has just arrived.
  it("never talks about being new", () => {
    for (const step of CATALOGUE) {
      const html = (stepEmailHtml(step.key, opts) ?? "").toLowerCase();
      for (const phrase of ["welcome", "getting started", "just joined", "new here"]) {
        expect(html, `${step.key} says "${phrase}"`).not.toContain(phrase);
      }
    }
  });
});
