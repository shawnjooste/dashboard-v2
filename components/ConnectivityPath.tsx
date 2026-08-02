import type { PathHop } from "@/lib/views/connectivity";
import { HOP_KIND_LABELS, HOP_KIND_ICONS, connectorBroken, isStale } from "@/lib/connectivity-helpers";

/** Tone for a hop node: unmonitored hops are neutral (they're labels, not
 *  measurements), stale ones are muted rather than claiming to be live. */
function hopTone(hop: PathHop, nowMs: number): "up" | "down" | "unknown" | "plain" {
  if (hop.librenmsDeviceId == null) return "plain";
  if (isStale(hop.lastCheckedAt, nowMs)) return "unknown";
  if (hop.lastUp === true) return "up";
  if (hop.lastUp === false) return "down";
  return "unknown";
}

const DOT: Record<string, string> = {
  up: "bg-good",
  down: "bg-brand",
  unknown: "bg-warn",
  plain: "bg-line",
};

/**
 * The route a client's traffic takes, drawn as a chain: internet → core →
 * distribution → their site. Hops mapped to LibreNMS carry their own live
 * status, so an outage shows *where* it is rather than just that it exists.
 */
export function ConnectivityPath({ hops }: { hops: PathHop[] }) {
  if (hops.length === 0) return null;
  const nowMs = Date.now();
  const tones = hops.map((h) => hopTone(h, nowMs));

  return (
    <div className="border-b border-line-soft px-4 py-3.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-faint">Path</div>
      <div className="mt-2.5 flex flex-col gap-1 sm:flex-row sm:items-start">
        {hops.map((hop, i) => {
          const tone = tones[i];
          const broken =
            i > 0 &&
            connectorBroken({
              up: hop.lastUp,
              monitored: hop.librenmsDeviceId != null && !isStale(hop.lastCheckedAt, nowMs),
            });
          return (
            <div key={hop.id} className="flex items-start gap-1 sm:flex-1 sm:flex-col sm:items-stretch">
              {i > 0 && (
                <>
                  {/* connector: vertical on mobile, horizontal on desktop */}
                  <span
                    aria-hidden
                    className={`mx-auto my-0.5 h-4 w-px shrink-0 sm:hidden ${broken ? "bg-brand" : "bg-line"}`}
                  />
                  <span
                    aria-hidden
                    className={`hidden h-px w-full sm:block ${broken ? "bg-brand" : "bg-line"}`}
                    style={{ marginTop: 22 }}
                  />
                </>
              )}
              <div className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-2.5 py-2 sm:-mt-[23px]">
                <div className="flex items-center gap-1.5">
                  <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${DOT[tone]}`} />
                  <span className="shrink-0 text-[13px] leading-none text-ink-3">{HOP_KIND_ICONS[hop.kind] ?? "●"}</span>
                  <span className="truncate text-[12.5px] font-semibold text-ink">{hop.label}</span>
                </div>
                <div className="mt-0.5 truncate text-[11px] text-muted">
                  {HOP_KIND_LABELS[hop.kind] ?? "Hop"}
                  {tone === "up" && hop.latencyMs != null ? ` · ${hop.latencyMs.toFixed(1)} ms` : ""}
                  {tone === "down" ? " · down" : ""}
                  {tone === "unknown" ? " · no reading" : ""}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
