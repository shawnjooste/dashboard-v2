import { describe, it, expect } from "vitest";
import { POST_LOGIN_PATH, resolveLandingPath, staffRedirectFor, type RouteInput } from "../routing";

const base: RouteInput = {
  authenticated: true,
  role: "client_member",
  status: "active",
  hasClient: true,
  hasClaimedDevice: true,
};

describe("POST_LOGIN_PATH", () => {
  it("lands a sign-in on the status page", () => {
    expect(POST_LOGIN_PATH).toBe("/status");
  });
  it("carries staff on to their own status page, not the client one", () => {
    expect(staffRedirectFor(POST_LOGIN_PATH)).toBe("/admin/status");
  });
});

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

describe("staffRedirectFor", () => {
  it("sends staff following a /status link to the staff status page", () => {
    expect(staffRedirectFor("/status")).toBe("/admin/status");
  });
  it("sends staff to the overview from any other client route", () => {
    for (const p of ["/", "/billing", "/devices", "/support", "/pending"]) {
      expect(staffRedirectFor(p)).toBe("/admin");
    }
  });
  it("does not match paths that merely start with /status", () => {
    expect(staffRedirectFor("/statusboard")).toBe("/admin");
    expect(staffRedirectFor("/status/x")).toBe("/admin");
  });
});
