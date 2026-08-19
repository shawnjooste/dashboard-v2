import { describe, it, expect } from "vitest";
import { shapePublicStatus } from "../public-status";

const inc = (over: Partial<Parameters<typeof shapePublicStatus>[0][number]> = {}) => ({
  id: "i1",
  title: "Something broke",
  type: "outage",
  scope: "global",
  status: "active",
  started_at: "2026-08-05T08:00:00Z",
  resolved_at: null,
  ...over,
});

const upd = (incident_id: string, body: string, created_at: string) => ({
  incident_id,
  body,
  created_at,
});

describe("shapePublicStatus", () => {
  it("reports all clear when nothing is active", () => {
    const r = shapePublicStatus([], []);
    expect(r).toEqual({ worst: null, active: [], recent: [] });
  });

  it("reports the worst active type", () => {
    const r = shapePublicStatus(
      [
        inc({ id: "a", type: "degraded" }),
        inc({ id: "b", type: "outage" }),
        inc({ id: "c", type: "maintenance" }),
      ],
      [],
    );
    expect(r.worst).toBe("outage");
    expect(r.active.map((i) => i.id)).toEqual(["b", "a", "c"]);
  });

  it("carries only the newest update for each incident", () => {
    const r = shapePublicStatus(
      [inc({ id: "a" })],
      [
        upd("a", "first", "2026-08-05T08:00:00Z"),
        upd("a", "newest", "2026-08-05T10:30:00Z"),
        upd("a", "middle", "2026-08-05T09:00:00Z"),
      ],
    );
    expect(r.active[0].latest?.body).toBe("newest");
  });

  it("leaves latest null when an incident has no updates", () => {
    const r = shapePublicStatus([inc({ id: "a" })], []);
    expect(r.active[0].latest).toBeNull();
  });

  it("caps recently resolved at five, newest first", () => {
    const resolved = Array.from({ length: 8 }, (_, n) =>
      inc({
        id: `r${n}`,
        status: "resolved",
        resolved_at: `2026-08-0${n + 1}T09:00:00Z`,
      }),
    );
    const r = shapePublicStatus(resolved, []);
    expect(r.recent).toHaveLength(5);
    expect(r.recent[0].id).toBe("r7");
    expect(r.worst).toBeNull();
  });

  // Redundant with the query filter in getPublicStatus, and deliberately so:
  // this is the assertion that fails if that query is ever widened.
  it("drops any incident that is not global, even if handed one directly", () => {
    const r = shapePublicStatus(
      [
        inc({ id: "secret", scope: "clients", title: "Fibre down at a named client" }),
        inc({ id: "ok", scope: "global" }),
      ],
      [],
    );
    expect(r.active.map((i) => i.id)).toEqual(["ok"]);
    expect(JSON.stringify(r)).not.toContain("named client");
  });

  it("drops non-global incidents from the resolved list too", () => {
    const r = shapePublicStatus(
      [inc({ id: "s", scope: "clients", status: "resolved", resolved_at: "2026-08-01T09:00:00Z" })],
      [],
    );
    expect(r.recent).toEqual([]);
  });
});
