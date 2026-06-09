import { describe, it, expect } from "vitest";
import { USER_ROLES, isClientScoped, normalizeAvStatus } from "../domain";

describe("domain", () => {
  it("exposes the three roles", () => {
    expect(USER_ROLES).toEqual(["rocking_staff", "client_manager", "client_member"]);
  });

  it("treats members and managers as client-scoped, staff as not", () => {
    expect(isClientScoped("client_member")).toBe(true);
    expect(isClientScoped("client_manager")).toBe(true);
    expect(isClientScoped("rocking_staff")).toBe(false);
  });

  it("normalizes Datto AV status text to a boolean", () => {
    expect(normalizeAvStatus("Datto AV Running & up-to-date")).toBe(true);
    expect(normalizeAvStatus("Datto AV Not running")).toBe(false);
    expect(normalizeAvStatus("")).toBe(null);
  });
});
