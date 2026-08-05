import { describe, expect, it } from "vitest";
import { bannerIncident, chatOpenedByIncident, type ActiveIncident } from "./incident-mode";

function incident(o: Partial<ActiveIncident> = {}): ActiveIncident {
  return {
    id: o.id ?? "i1",
    title: o.title ?? "Fibre down",
    type: o.type ?? "outage",
    opensChat: o.opensChat ?? false,
  };
}

describe("chatOpenedByIncident", () => {
  it("is off when nothing is active", () => {
    expect(chatOpenedByIncident([])).toBe(false);
  });

  it("is off for an active incident that did not open chat", () => {
    expect(chatOpenedByIncident([incident()])).toBe(false);
  });

  it("is on when any visible incident opened chat", () => {
    expect(chatOpenedByIncident([incident(), incident({ id: "i2", opensChat: true })])).toBe(true);
  });

  it("opens chat on any type, not just outages", () => {
    expect(chatOpenedByIncident([incident({ type: "maintenance", opensChat: true })])).toBe(true);
  });
});

describe("bannerIncident", () => {
  it("shows nothing when nothing is active", () => {
    expect(bannerIncident([])).toBeNull();
  });

  it("banners an outage", () => {
    expect(bannerIncident([incident({ title: "Telkom down" })])?.title).toBe("Telkom down");
  });

  it("stays quiet for degraded and maintenance", () => {
    const quiet = [incident({ type: "degraded" }), incident({ id: "i2", type: "maintenance" })];
    expect(bannerIncident(quiet)).toBeNull();
  });

  it("banners a non-outage that opened chat, so the widget is never unexplained", () => {
    const i = incident({ id: "i2", type: "degraded", opensChat: true, title: "Slow email" });
    expect(bannerIncident([i])?.title).toBe("Slow email");
  });

  it("prefers the outage when several are running", () => {
    const list = [
      incident({ id: "i1", type: "maintenance", opensChat: true }),
      incident({ id: "i2", type: "outage", title: "Fibre cut" }),
    ];
    expect(bannerIncident(list)?.title).toBe("Fibre cut");
  });

  it("keeps the caller's order within a type — newest first", () => {
    const list = [
      incident({ id: "new", title: "Newest outage" }),
      incident({ id: "old", title: "Older outage" }),
    ];
    expect(bannerIncident(list)?.id).toBe("new");
  });
});
