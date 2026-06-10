import { describe, it, expect } from "vitest";
import {
  isAuthCookie,
  backupName,
  originalName,
  encodeMarker,
  decodeMarker,
} from "./impersonation";

describe("impersonation helpers", () => {
  it("recognises supabase auth cookies, including chunked ones", () => {
    expect(isAuthCookie("sb-eskhokedsximnslgsycs-auth-token")).toBe(true);
    expect(isAuthCookie("sb-eskhokedsximnslgsycs-auth-token.0")).toBe(true);
    expect(isAuthCookie("sb-eskhokedsximnslgsycs-auth-token.1")).toBe(true);
    expect(isAuthCookie("imp")).toBe(false);
    expect(isAuthCookie("sb-something-else")).toBe(false);
  });

  it("maps backup names both ways", () => {
    const name = "sb-x-auth-token.0";
    expect(backupName(name)).toBe("imp-bak.sb-x-auth-token.0");
    expect(originalName(backupName(name))).toBe(name);
    expect(originalName("unrelated")).toBe(null);
  });

  it("round-trips the marker and rejects garbage", () => {
    const m = { logId: "abc-123", email: "rose@gsrlaw.co.za" };
    expect(decodeMarker(encodeMarker(m))).toEqual(m);
    expect(decodeMarker(undefined)).toBe(null);
    expect(decodeMarker("not-base64-json")).toBe(null);
  });
});
