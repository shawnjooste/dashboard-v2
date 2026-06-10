// Pure display/derivation helpers for the M365 view. The CLI stores raw Graph
// values; these run at read time.

/** Graph auth-method @odata.type → short label. */
export function methodLabel(odataType: string): string {
  const t = odataType.replace("#microsoft.graph.", "").replace("AuthenticationMethod", "");
  const map: Record<string, string> = {
    microsoftAuthenticator: "Authenticator",
    phone: "Phone",
    fido2: "FIDO2 key",
    windowsHelloForBusiness: "Windows Hello",
    softwareOath: "Authenticator app (OATH)",
    temporaryAccessPass: "Temporary access pass",
    email: "Email",
    password: "Password",
  };
  return map[t] ?? t;
}

/** Distinct, password-excluded method labels for a user. */
export function strongMethodLabels(methods: string[]): string[] {
  const labels = methods
    .filter((m) => !m.toLowerCase().includes("password"))
    .map(methodLabel);
  return [...new Set(labels)];
}

/** Percentage of licensed users with strong MFA. Null if no licensed users. */
export function mfaCoveragePct(
  users: { isLicensed: boolean; mfaStrong: boolean }[],
): number | null {
  const licensed = users.filter((u) => u.isLicensed);
  if (licensed.length === 0) return null;
  return Math.round((100 * licensed.filter((u) => u.mfaStrong).length) / licensed.length);
}
