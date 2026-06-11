import { describe, it, expect } from "vitest";
import { isAuthCookie, encodeMarker, decodeMarker } from "./impersonation";

describe("impersonation helpers", () => {
  it("recognises supabase auth cookies, including chunked ones", () => {
    expect(isAuthCookie("sb-eskhokedsximnslgsycs-auth-token")).toBe(true);
    expect(isAuthCookie("sb-eskhokedsximnslgsycs-auth-token.0")).toBe(true);
    expect(isAuthCookie("imp")).toBe(false);
    expect(isAuthCookie("sb-something-else")).toBe(false);
  });

  it("round-trips the marker (target + admin email) and rejects garbage", () => {
    const m = { logId: "abc-123", email: "rose@gsrlaw.co.za", adminEmail: "shawn@rocking.one" };
    expect(decodeMarker(encodeMarker(m))).toEqual(m);
    expect(decodeMarker(undefined)).toBe(null);
    expect(decodeMarker("not-base64-json")).toBe(null);
  });

  it("tolerates a legacy marker without adminEmail", () => {
    const legacy = Buffer.from(JSON.stringify({ logId: "x", email: "y@z.com" })).toString("base64url");
    expect(decodeMarker(legacy)).toEqual({ logId: "x", email: "y@z.com", adminEmail: "" });
  });
});
