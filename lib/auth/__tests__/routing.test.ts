import { describe, it, expect } from "vitest";
import { resolveLandingPath, type RouteInput } from "../routing";

const base: RouteInput = {
  authenticated: true,
  role: "client_member",
  status: "active",
  hasClient: true,
  hasClaimedDevice: true,
};

describe("resolveLandingPath", () => {
  it("sends unauthenticated users to /login", () => {
    expect(resolveLandingPath({ ...base, authenticated: false })).toBe("/login");
  });
  it("sends rocking staff to /admin", () => {
    expect(resolveLandingPath({ ...base, role: "rocking_staff", hasClient: false })).toBe("/admin");
  });
  it("sends pending users to /pending", () => {
    expect(resolveLandingPath({ ...base, status: "pending", hasClient: false })).toBe("/pending");
  });
  it("sends active members with no claimed device to /app (no self-claim)", () => {
    expect(resolveLandingPath({ ...base, hasClaimedDevice: false })).toBe("/app");
  });
  it("sends fully-onboarded members to /app", () => {
    expect(resolveLandingPath(base)).toBe("/app");
  });
  it("sends managers to /app regardless of personal device claim", () => {
    expect(resolveLandingPath({ ...base, role: "client_manager", hasClaimedDevice: false })).toBe("/app");
  });
});
