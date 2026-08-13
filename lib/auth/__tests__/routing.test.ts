import { describe, it, expect } from "vitest";
import { POST_LOGIN_PATH, resolveLandingPath, staffRedirectFor, safeNext, type RouteInput } from "../routing";

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

describe("safeNext", () => {
  it("keeps a relative path, including its query string", () => {
    expect(safeNext("/quotes/abc")).toBe("/quotes/abc");
    expect(safeNext("/quotes/abc?reference=qs-123")).toBe("/quotes/abc?reference=qs-123");
  });

  it("falls back when nothing was asked for", () => {
    expect(safeNext(null)).toBe(POST_LOGIN_PATH);
    expect(safeNext(undefined)).toBe(POST_LOGIN_PATH);
    expect(safeNext("")).toBe(POST_LOGIN_PATH);
  });

  // Everything below is an attack. next= travels in emailed URLs, so each of
  // these is something a third party could put in front of a client.
  it("refuses a protocol-relative URL", () => {
    expect(safeNext("//evil.com")).toBe(POST_LOGIN_PATH);
    expect(safeNext("//evil.com/quotes/abc")).toBe(POST_LOGIN_PATH);
  });

  it("refuses an absolute URL", () => {
    expect(safeNext("https://evil.com")).toBe(POST_LOGIN_PATH);
    expect(safeNext("http://evil.com")).toBe(POST_LOGIN_PATH);
  });

  it("refuses a backslash path — browsers treat \\ as /", () => {
    expect(safeNext("/\\evil.com")).toBe(POST_LOGIN_PATH);
    expect(safeNext("/\\/evil.com")).toBe(POST_LOGIN_PATH);
  });

  it("refuses a scheme that isn't a path at all", () => {
    expect(safeNext("javascript:alert(1)")).toBe(POST_LOGIN_PATH);
    expect(safeNext("data:text/html,<script>")).toBe(POST_LOGIN_PATH);
  });

  it("refuses anything that doesn't start with a single slash", () => {
    expect(safeNext("quotes/abc")).toBe(POST_LOGIN_PATH);
    expect(safeNext(" /quotes/abc")).toBe(POST_LOGIN_PATH);
  });
});
