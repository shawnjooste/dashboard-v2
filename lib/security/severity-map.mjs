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

// Strips volatile numeric/percentage/unit tokens from a Datto diagnostics
// message so two nights of the SAME ongoing alert (e.g. a disk-full percent
// ticking up) hash identically, while genuinely different messages of the
// same alert_policy (e.g. "Disk C" vs "Disk D") stay distinguishable.
export function stableMessageKey(message) {
  return (message ?? "")
    .replace(/\d+(\.\d+)?\s*(%|GB|MB|KB|TB|ms|s|min|hrs?|days?)?/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Keyed on alert_policy (Datto's stable "@class") + a drift-normalized form
// of the message, NOT the raw diagnostics text — the raw message drifts
// run-to-run for a still-open alert (e.g. a disk-full percentage), which
// would otherwise mint a new row every night for the same ongoing alert.
// alert_policy alone would collide two distinct same-second alerts sharing a
// policy class (device_alerts allows this); the normalized message restores
// per-alert distinctness without reintroducing drift sensitivity.
export const refDattoAlert = (uid, triggeredAt, alertPolicy, message) =>
  `datto:alert:${uid}:${triggeredAt}:${hashText(`${alertPolicy ?? ""}|${stableMessageKey(message)}`)}`;
export const refDattoAv = (uid) => `datto:av_off:${uid}`;
export const refDattoPatch = (uid) => `datto:patch:${uid}`;
export const refM365Mfa = (userId) => `m365:mfa:${userId}`;
export const refM365SecDefaults = (clientId) => `m365:security_defaults:${clientId}`;
export const refM365Disabled = (userId) => `m365:account_disabled:${userId}`;
// For 'offline': lastSeenAt freezes while a device stays down and only
// advances once it's next seen online — a fresh outage after recovery gets
// a new ref, a still-down device keeps reusing the same one (no nightly
// spam). 'alerting' (Meraki: online but unhealthy) does NOT freeze
// last_seen_at — the device keeps reporting — so it's deliberately excluded
// from the timestamp to avoid the same nightly-spam problem for that status.
export const refNetworkDown = (sourceDeviceId, status, lastSeenAt) =>
  status === "offline"
    ? `network:down:${sourceDeviceId}:${lastSeenAt ?? "unknown"}`
    : `network:down:${sourceDeviceId}:${status}`;

/** Posture rows open in the DB whose weakness no longer appears in source. */
export function postureToResolve(existingOpenRefs, currentRefs) {
  const current = new Set(currentRefs);
  return existingOpenRefs.filter((r) => !current.has(r));
}
