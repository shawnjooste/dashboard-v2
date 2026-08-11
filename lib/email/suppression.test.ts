import { describe, expect, it } from "vitest";
import { isSuppressible, splitRecipients, SUPPRESSIBLE_CATEGORIES } from "./suppression";

const optedOut = new Set(["gavin@keller.education"]);

describe("SUPPRESSIBLE_CATEGORIES", () => {
  it("contains portal_update and onboarding_step, and nothing else", () => {
    expect([...SUPPRESSIBLE_CATEGORIES]).toEqual(["portal_update", "onboarding_step"]);
  });
});

describe("isSuppressible", () => {
  it("is true only for portal_update and onboarding_step", () => {
    expect(isSuppressible("portal_update")).toBe(true);
    expect(isSuppressible("onboarding_step")).toBe(true);
    for (const c of ["quote", "booking", "onboarding", "job", "admin_alert", "general", undefined]) {
      expect(isSuppressible(c)).toBe(false);
    }
  });

  it("suppresses onboarding step emails", () => {
    expect(isSuppressible("onboarding_step")).toBe(true);
  });

  // The welcome email carries the sign-in link. It must always send.
  it("never suppresses the welcome email", () => {
    expect(isSuppressible("onboarding")).toBe(false);
  });
});

describe("splitRecipients", () => {
  it("never filters a transactional category, even for an opted-out address", () => {
    const out = splitRecipients(["gavin@keller.education"], "quote", optedOut);
    expect(out.send).toEqual(["gavin@keller.education"]);
    expect(out.suppressed).toEqual([]);
  });

  it("drops opted-out addresses from a portal update", () => {
    const out = splitRecipients(["a@x.com", "gavin@keller.education"], "portal_update", optedOut);
    expect(out.send).toEqual(["a@x.com"]);
    expect(out.suppressed).toEqual(["gavin@keller.education"]);
  });

  it("matches addresses case-insensitively", () => {
    const out = splitRecipients(["GAVIN@Keller.Education"], "portal_update", optedOut);
    expect(out.send).toEqual([]);
    expect(out.suppressed).toEqual(["GAVIN@Keller.Education"]);
  });

  it("returns an empty send list when everyone opted out", () => {
    const out = splitRecipients(["gavin@keller.education"], "portal_update", optedOut);
    expect(out.send).toEqual([]);
  });

  it("handles an undefined category and an empty opt-out set", () => {
    const out = splitRecipients(["a@x.com"], undefined, new Set());
    expect(out.send).toEqual(["a@x.com"]);
  });

  it("does not mutate its inputs", () => {
    const to = ["a@x.com", "gavin@keller.education"];
    const set = new Set(["gavin@keller.education"]);
    splitRecipients(to, "portal_update", set);
    expect(to).toEqual(["a@x.com", "gavin@keller.education"]);
    expect([...set]).toEqual(["gavin@keller.education"]);
  });
});
