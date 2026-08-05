import { describe, it, expect } from "vitest";
import { resolvePendingAccess } from "../pending-access";

const at = (pathname: string) => ({ status: "active" as const, hasClient: true, pathname });
const waiting = (pathname: string) => ({ status: "pending" as const, hasClient: false, pathname });
const declined = (pathname: string) => ({ status: "rejected" as const, hasClient: false, pathname });

describe("resolvePendingAccess", () => {
  it("lets an approved user with a company through anywhere", () => {
    for (const p of ["/", "/billing", "/devices", "/status", "/pending"]) {
      expect(resolvePendingAccess(at(p))).toEqual({ mode: "full", redirectTo: null });
    }
  });

  it("lets a pending user reach the holding page and the status page", () => {
    expect(resolvePendingAccess(waiting("/pending")).redirectTo).toBeNull();
    expect(resolvePendingAccess(waiting("/status")).redirectTo).toBeNull();
    expect(resolvePendingAccess(waiting("/status")).mode).toBe("pending");
  });

  it("holds a pending user on everything else", () => {
    for (const p of ["/", "/billing", "/devices", "/m365", "/team", "/quotes"]) {
      expect(resolvePendingAccess(waiting(p))).toEqual({ mode: "pending", redirectTo: "/pending" });
    }
  });

  it("holds an active profile that has no company", () => {
    const r = resolvePendingAccess({ status: "active", hasClient: false, pathname: "/billing" });
    expect(r).toEqual({ mode: "pending", redirectTo: "/pending" });
  });

  it("holds a pending profile even once it has a company", () => {
    const r = resolvePendingAccess({ status: "pending", hasClient: true, pathname: "/billing" });
    expect(r.mode).toBe("pending");
  });

  it("gives a rejected user the holding page and nothing else", () => {
    expect(resolvePendingAccess(declined("/pending"))).toEqual({
      mode: "rejected",
      redirectTo: null,
    });
    expect(resolvePendingAccess(declined("/status"))).toEqual({
      mode: "rejected",
      redirectTo: "/pending",
    });
    expect(resolvePendingAccess(declined("/billing")).redirectTo).toBe("/pending");
  });

  it("does not prefix-match its way into child routes", () => {
    expect(resolvePendingAccess(waiting("/status/secret")).redirectTo).toBe("/pending");
    expect(resolvePendingAccess(waiting("/statusboard")).redirectTo).toBe("/pending");
  });
});
