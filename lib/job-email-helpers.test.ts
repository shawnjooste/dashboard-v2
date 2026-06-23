import { describe, it, expect } from "vitest";
import { greetingName, assigneeGreetingName, assignmentEmailContent } from "./job-email-helpers";

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

describe("assigneeGreetingName", () => {
  it("uses the person's first name for a client manager", () => {
    expect(
      assigneeGreetingName({ kind: "client", email: "monique@gsrlaw.co.za", person: { first_name: "Monique", display_name: "Monique Siers" } }),
    ).toBe("Monique");
  });
  it("derives a capitalised name from a staffer's email local-part", () => {
    expect(assigneeGreetingName({ kind: "staff", email: "shawn@rocking.one", person: null })).toBe("Shawn");
    expect(assigneeGreetingName({ kind: "staff", email: "sam.r@rocking.one", person: null })).toBe("Sam r");
  });
  it("falls back to a neutral greeting for a client manager with no name", () => {
    expect(assigneeGreetingName({ kind: "client", email: "info@acme.co", person: null })).toBe("there");
  });
});

describe("assignmentEmailContent", () => {
  it("uses a direct, internal tone for staff", () => {
    const { subject, body } = assignmentEmailContent({ kind: "staff", name: "Sam", jobTitle: "Openserve fibre", taskLabel: "Confirm build scheduled" });
    expect(subject).toContain("Openserve fibre");
    expect(body).toContain("Hi Sam,");
    expect(body).toContain("You've been assigned a task");
    expect(body).toContain("Confirm build scheduled");
  });
  it("uses a softer, client-facing tone for client managers", () => {
    const { subject, body } = assignmentEmailContent({ kind: "client", name: "Monique", jobTitle: "Openserve fibre", taskLabel: "Confirm no extra cabling cost" });
    expect(subject).toContain("Openserve fibre");
    expect(body).toContain("Hi Monique,");
    expect(body).toContain("action for you");
    expect(body).toContain("Rocking");
    expect(body).toContain("Confirm no extra cabling cost");
  });
});
