import { describe, expect, it } from "vitest";
import { fmtDate, fmtDateTime, fmtTime } from "./time";

describe("SAST formatting", () => {
  // The exact instant the J2 CPE outage was stamped — shown as 04:40 (UTC)
  // before this existed, when it was 06:40 for everyone reading the portal.
  const outage = "2026-08-03T04:40:03.320Z";

  it("shifts UTC to SAST (+2)", () => {
    expect(fmtDateTime(outage)).toBe("2026-08-03 06:40");
    expect(fmtTime(outage)).toBe("06:40");
    expect(fmtDate(outage)).toBe("2026-08-03");
  });

  it("rolls the date over when +2 crosses midnight", () => {
    expect(fmtDateTime("2026-08-02T22:15:00Z")).toBe("2026-08-03 00:15");
    expect(fmtDate("2026-08-02T22:15:00Z")).toBe("2026-08-03");
  });

  it("handles a Postgres offset timestamp identically", () => {
    // Same instant, expressed the way PostgREST returns it.
    expect(fmtDateTime("2026-08-03T04:40:03.32+00:00")).toBe("2026-08-03 06:40");
  });

  it("pads single digits", () => {
    expect(fmtDateTime("2026-01-05T06:07:00Z")).toBe("2026-01-05 08:07");
  });

  it("falls back for null, undefined and junk", () => {
    expect(fmtDateTime(null)).toBe("—");
    expect(fmtDateTime(undefined)).toBe("—");
    expect(fmtDateTime("not a date")).toBe("—");
    expect(fmtTime(null, "never")).toBe("never");
  });
});
