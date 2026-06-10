import { describe, it, expect } from "vitest";
import { methodLabel, strongMethodLabels, mfaCoveragePct } from "./m365-derive";
import { friendlySku } from "./m365-skus";

describe("m365 derive", () => {
  it("labels known auth methods and falls back", () => {
    expect(methodLabel("#microsoft.graph.microsoftAuthenticatorAuthenticationMethod")).toBe("Authenticator");
    expect(methodLabel("#microsoft.graph.phoneAuthenticationMethod")).toBe("Phone");
    expect(methodLabel("#microsoft.graph.somethingNewAuthenticationMethod")).toBe("somethingNew");
  });

  it("returns distinct strong (non-password) method labels", () => {
    const methods = [
      "#microsoft.graph.passwordAuthenticationMethod",
      "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod",
      "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod",
      "#microsoft.graph.phoneAuthenticationMethod",
    ];
    expect(strongMethodLabels(methods)).toEqual(["Authenticator", "Phone"]);
    expect(strongMethodLabels(["#microsoft.graph.passwordAuthenticationMethod"])).toEqual([]);
  });

  it("computes MFA coverage over licensed users only", () => {
    const users = [
      { isLicensed: true, mfaStrong: true },
      { isLicensed: true, mfaStrong: false },
      { isLicensed: false, mfaStrong: false }, // unlicensed — excluded
    ];
    expect(mfaCoveragePct(users)).toBe(50);
    expect(mfaCoveragePct([{ isLicensed: false, mfaStrong: false }])).toBe(null);
  });
});

describe("m365 skus", () => {
  it("maps known SKUs and falls back to the raw code", () => {
    expect(friendlySku("O365_BUSINESS_PREMIUM")).toBe("Microsoft 365 Business Standard");
    expect(friendlySku("WHATEVER_NEW_SKU")).toBe("WHATEVER_NEW_SKU");
  });
});
