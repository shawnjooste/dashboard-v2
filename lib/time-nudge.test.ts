import { describe, expect, it } from "vitest";
import { buildNudges, nudgeHtml, ticketsNeedingTime, type NudgeTicket } from "./time-nudge";

const NOW = new Date("2026-08-07T09:00:00Z");
const mk = (o: Partial<NudgeTicket> = {}): NudgeTicket => ({
  id: o.id ?? 1,
  subject: o.subject ?? "Printer down",
  clientName: "clientName" in o ? (o.clientName ?? null) : "GSR Law",
  updatedAt: o.updatedAt ?? "2026-08-05T10:00:00Z",
  loggedMinutes: o.loggedMinutes ?? 0,
});

describe("ticketsNeedingTime", () => {
  it("includes recent tickets with no logged time", () => {
    expect(ticketsNeedingTime([mk()], NOW)).toHaveLength(1);
  });
  it("excludes tickets that already have time", () => {
    expect(ticketsNeedingTime([mk({ loggedMinutes: 30 })], NOW)).toHaveLength(0);
  });
  it("excludes tickets older than the window", () => {
    expect(ticketsNeedingTime([mk({ updatedAt: "2026-07-20T10:00:00Z" })], NOW)).toHaveLength(0);
  });
  it("sorts newest first", () => {
    const out = ticketsNeedingTime(
      [mk({ id: 1, updatedAt: "2026-08-02T10:00:00Z" }), mk({ id: 2, updatedAt: "2026-08-06T10:00:00Z" })],
      NOW,
    );
    expect(out.map((t) => t.id)).toEqual([2, 1]);
  });
});

describe("buildNudges", () => {
  it("sends nothing when everything is logged", () => {
    expect(buildNudges(["tim@rocking.one"], [])).toEqual([]);
  });
  it("gives every recipient the same list", () => {
    const n = buildNudges(["tim@rocking.one", "gareth@rocking.one"], [mk()]);
    expect(n).toHaveLength(2);
    expect(n[0].subject).toBe("1 ticket needs time logged");
  });
  it("pluralises correctly", () => {
    expect(buildNudges(["a@b.c"], [mk({ id: 1 }), mk({ id: 2 })])[0].subject).toBe("2 tickets need time logged");
  });
});

describe("nudgeHtml", () => {
  it("links each ticket into the admin workspace", () => {
    const html = nudgeHtml([mk({ id: 42 })], "https://portal.rocking.one");
    expect(html).toContain("https://portal.rocking.one/admin/tickets/42");
    expect(html).toContain("Printer down");
    expect(html).toContain("GSR Law");
  });
  it("names an unmatched client rather than leaving it blank", () => {
    expect(nudgeHtml([mk({ clientName: null })], "https://x")).toContain("unmatched client");
  });
});
