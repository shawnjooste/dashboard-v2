import { describe, it, expect } from "vitest";
import { buildDigest, buildDigests } from "./job-digest";

const TODAY = "2026-07-28";

const person = (over: Partial<Parameters<typeof buildDigest>[0]> = {}) => ({
  email: "tim@rocking.one",
  name: "Tim",
  ownedJobs: [{ title: "3CX migration", clientName: "Networkers Int", dueDate: null }],
  assignedTasks: [],
  ...over,
});

describe("buildDigest", () => {
  it("returns null when there is nothing open", () => {
    expect(buildDigest(person({ ownedJobs: [], assignedTasks: [] }), TODAY)).toBeNull();
  });
  it("greets by name and names the job", () => {
    const d = buildDigest(person(), TODAY)!;
    expect(d.email).toBe("tim@rocking.one");
    expect(d.body).toContain("Hi Tim,");
    expect(d.body).toContain("3CX migration");
    expect(d.body).toContain("Networkers Int");
  });
  it("summarises counts in the subject", () => {
    const d = buildDigest(
      person({
        ownedJobs: [{ title: "A", clientName: "C", dueDate: null }],
        assignedTasks: [{ label: "T", jobTitle: "A", clientName: "C", dueDate: null }],
      }),
      TODAY,
    )!;
    expect(d.subject).toContain("1 job");
    expect(d.subject).toContain("1 task");
  });
  it("uses singular and plural correctly", () => {
    const d = buildDigest(
      person({
        ownedJobs: [
          { title: "A", clientName: "C", dueDate: null },
          { title: "B", clientName: "C", dueDate: null },
        ],
        assignedTasks: [],
      }),
      TODAY,
    )!;
    expect(d.subject).toContain("2 jobs");
    expect(d.subject).not.toContain("task");
  });
  it("marks overdue items and lists them first", () => {
    const d = buildDigest(
      person({
        ownedJobs: [
          { title: "Later", clientName: "C", dueDate: "2026-08-30" },
          { title: "Late", clientName: "C", dueDate: "2026-07-01" },
          { title: "Undated", clientName: "C", dueDate: null },
        ],
      }),
      TODAY,
    )!;
    expect(d.body.indexOf("Late<")).toBeLessThan(d.body.indexOf("Later<"));
    expect(d.body.indexOf("Later<")).toBeLessThan(d.body.indexOf("Undated<"));
    expect(d.body).toContain("Overdue");
  });
  it("omits the tasks section entirely when there are none", () => {
    const d = buildDigest(person({ assignedTasks: [] }), TODAY)!;
    expect(d.body).not.toContain("Tasks assigned to you");
  });
  it("includes the tasks section when there are tasks", () => {
    const d = buildDigest(
      person({ assignedTasks: [{ label: "Clean laptops", jobTitle: "Laptop Assessment", clientName: "NI", dueDate: null }] }),
      TODAY,
    )!;
    expect(d.body).toContain("Tasks assigned to you");
    expect(d.body).toContain("Clean laptops");
  });
  it("omits the jobs section entirely when there are none", () => {
    const d = buildDigest(
      person({
        ownedJobs: [],
        assignedTasks: [{ label: "Clean laptops", jobTitle: "Laptop Assessment", clientName: "NI", dueDate: null }],
      }),
      TODAY,
    )!;
    expect(d.body).not.toContain("Jobs you own");
    expect(d.body).toContain("Tasks assigned to you");
    expect(d.body).toContain("Clean laptops");
  });
  it("marks items due within 2 days as 'Due soon'", () => {
    const d = buildDigest(
      person({
        ownedJobs: [{ title: "Urgent", clientName: "C", dueDate: "2026-07-30" }],
        assignedTasks: [],
      }),
      TODAY,
    )!;
    expect(d.body).toContain("Due soon");
    expect(d.body).not.toContain("Overdue");
  });
});

describe("buildDigest HTML escaping", () => {
  it("escapes & and < in a client name so it does not appear raw", () => {
    const d = buildDigest(
      person({
        ownedJobs: [{ title: "3CX migration", clientName: "Smith & Co <script>", dueDate: null }],
      }),
      TODAY,
    )!;
    expect(d.body).not.toContain("Smith & Co <script>");
    expect(d.body).toContain("Smith &amp; Co &lt;script&gt;");
  });
});

describe("buildDigests", () => {
  it("skips people with nothing open", () => {
    const out = buildDigests(
      [person(), person({ email: "idle@rocking.one", ownedJobs: [], assignedTasks: [] })],
      TODAY,
    );
    expect(out.map((d) => d.email)).toEqual(["tim@rocking.one"]);
  });
});
