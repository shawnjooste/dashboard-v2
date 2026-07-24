/** Pure severity/category mapping + source_ref builders for the security
 *  data plane (MDR sub-project A). .mjs so BOTH the Node normalizer script
 *  and the app import it. Tuning severity = editing this file + its test,
 *  never a schema change. Keep in sync with the table in
 *  docs/superpowers/specs/2026-07-24-security-data-plane-design.md. */

export function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function mapDattoAlert(priority) {
  const p = (priority ?? "").toLowerCase();
  if (p === "critical") return { category: "monitoring", severity: "critical" };
  if (p === "high") return { category: "monitoring", severity: "high" };
  if (p === "moderate") return { category: "monitoring", severity: "medium" };
  return { category: "monitoring", severity: "low" };
}

export const mapDattoAvPosture = () => ({ category: "config", severity: "high" });

export function mapDattoPatchPosture(patchStatus) {
  const s = (patchStatus ?? "").replace(/\s+/g, "");
  if (s === "InstallError") return { category: "config", severity: "medium" };
  if (s === "RebootRequired") return { category: "config", severity: "low" };
  return null;
}

/** Licensed+enabled user without strong MFA: no methods at all → critical
 *  (password only), weak methods present → high. */
export function mapM365Identity(mfaMethods) {
  return { category: "identity", severity: mfaMethods.length === 0 ? "critical" : "high" };
}

export const mapM365SecurityDefaults = () => ({ category: "config", severity: "medium" });
export const mapM365AccountDisabled = () => ({ category: "identity", severity: "medium" });

export function mapNetworkDown(status) {
  return status === "offline" || status === "alerting"
    ? { category: "availability", severity: "medium" }
    : null;
}

export const refDattoAlert = (uid, triggeredAt, message) =>
  `datto:alert:${uid}:${triggeredAt}:${hashText(message)}`;
export const refDattoAv = (uid) => `datto:av_off:${uid}`;
export const refDattoPatch = (uid) => `datto:patch:${uid}`;
export const refM365Mfa = (userId) => `m365:mfa:${userId}`;
export const refM365SecDefaults = (clientId) => `m365:security_defaults:${clientId}`;
export const refM365Disabled = (userId) => `m365:account_disabled:${userId}`;
export const refNetworkDown = (sourceDeviceId) => `network:down:${sourceDeviceId}`;

/** Posture rows open in the DB whose weakness no longer appears in source. */
export function postureToResolve(existingOpenRefs, currentRefs) {
  const current = new Set(currentRefs);
  return existingOpenRefs.filter((r) => !current.has(r));
}
