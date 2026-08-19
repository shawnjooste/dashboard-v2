import { describe, it, expect } from "vitest";
import { shapePublicStatus } from "../public-status";

const inc = (over: Record<string, unknown> = {}) => ({
  id: "i1",
  title: "Something broke",
  type: "outage",
  scope: "global",
  status: "active",
  started_at: "2026-08-05T08:00:00Z",
  resolved_at: null,
  ...over,
});

const upd = (incident_id: string, body: string, created_at: string, is_resolution = false) => ({
  id: `${incident_id}-${created_at}`,
  incident_id,
  body,
  created_at,
  is_resolution,
});

describe("shapePublicStatus", () => {
  it("reports all clear when nothing is active", () => {
    const r = shapePublicStatus([], []);
    expect(r).toEqual({ worst: null, active: [], past: [] });
  });

  it("reports the worst active type and orders by severity", () => {
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

  it("carries the full update timeline, newest first", () => {
    const r = shapePublicStatus(
      [inc({ id: "a" })],
      [
        upd("a", "first", "2026-08-05T08:00:00Z"),
        upd("a", "newest", "2026-08-05T10:30:00Z"),
        upd("a", "middle", "2026-08-05T09:00:00Z"),
      ],
    );
    expect(r.active[0].updates.map((u) => u.body)).toEqual(["newest", "middle", "first"]);
  });

  it("keeps each incident's updates to itself", () => {
    const r = shapePublicStatus(
      [inc({ id: "a" }), inc({ id: "b" })],
      [upd("a", "for a", "2026-08-05T08:00:00Z"), upd("b", "for b", "2026-08-05T08:00:00Z")],
    );
    expect(r.active.find((i) => i.id === "a")!.updates.map((u) => u.body)).toEqual(["for a"]);
    expect(r.active.find((i) => i.id === "b")!.updates.map((u) => u.body)).toEqual(["for b"]);
  });

  it("lists past incidents with their timeline, newest first, capped at ten", () => {
    const resolved = Array.from({ length: 13 }, (_, n) =>
      inc({
        id: `r${n}`,
        status: "resolved",
        started_at: `2026-07-${String(n + 1).padStart(2, "0")}T08:00:00Z`,
        resolved_at: `2026-07-${String(n + 1).padStart(2, "0")}T09:00:00Z`,
      }),
    );
    const r = shapePublicStatus(resolved, [upd("r12", "fixed it", "2026-07-13T09:00:00Z", true)]);
    expect(r.past).toHaveLength(10);
    expect(r.past[0].id).toBe("r12");
    expect(r.past[0].updates[0].body).toBe("fixed it");
    expect(r.past[0].updates[0].isResolution).toBe(true);
    expect(r.worst).toBeNull();
  });

  it("shows past incidents even while something is active", () => {
    const r = shapePublicStatus(
      [
        inc({ id: "now" }),
        inc({ id: "then", status: "resolved", resolved_at: "2026-08-01T09:00:00Z" }),
      ],
      [],
    );
    expect(r.active.map((i) => i.id)).toEqual(["now"]);
    expect(r.past.map((i) => i.id)).toEqual(["then"]);
  });

  // Redundant with the query filter in getPublicStatus, and deliberately so:
  // this is the assertion that fails if that query is ever widened.
  it("drops any incident that is not global, even if handed one directly", () => {
    const r = shapePublicStatus(
      [
        inc({ id: "secret", scope: "clients", title: "Fibre down at a named client" }),
        inc({ id: "ok", scope: "global" }),
      ],
      [upd("secret", "a private detail", "2026-08-05T08:00:00Z")],
    );
    expect(r.active.map((i) => i.id)).toEqual(["ok"]);
    expect(JSON.stringify(r)).not.toContain("named client");
    expect(JSON.stringify(r)).not.toContain("private detail");
  });

  it("drops non-global incidents from the past list too", () => {
    const r = shapePublicStatus(
      [inc({ id: "s", scope: "clients", status: "resolved", resolved_at: "2026-08-01T09:00:00Z" })],
      [],
    );
    expect(r.past).toEqual([]);
  });
});
