import type { PathHop } from "@/lib/views/connectivity";
import { HOP_KIND_LABELS, HOP_KIND_ICONS, isStale } from "@/lib/connectivity-helpers";

type HopState = "up" | "down" | "idle";

/** Tile state. An unmonitored or stale hop is "idle" — drawn grey and dashed
 *  rather than claiming a reading we don't have. */
function hopState(hop: PathHop, nowMs: number): HopState {
  if (hop.librenmsDeviceId == null) return "idle";
  if (isStale(hop.lastCheckedAt, nowMs)) return "idle";
  if (hop.lastUp === true) return "up";
  if (hop.lastUp === false) return "down";
  return "idle";
}

const TILE: Record<HopState, string> = {
  up: "border-ink text-ink",
  down: "border-brand text-brand",
  idle: "border-line text-faint",
};

const DOT: Record<HopState, string | null> = {
  up: "bg-good-dot",
  down: "bg-brand",
  idle: null,
};

/**
 * The route a client's traffic takes: internet → core → distribution → their
 * device, as a chain of tiles. A hop mapped to LibreNMS carries its own live
 * status, so an outage shows *where* it is. The connector into a hop goes
 * dashed when that hop isn't live — a link waiting to be plugged in reads as
 * pending, not broken.
 */
export function ConnectivityPath({ hops }: { hops: PathHop[] }) {
  if (hops.length === 0) return null;
  const nowMs = Date.now();
  const states = hops.map((h) => hopState(h, nowMs));

  return (
    <div className="border-b border-line-soft px-4 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-faint">Path</div>

      <div className="mt-3 flex flex-col items-stretch gap-0 sm:flex-row sm:items-start">
        {hops.map((hop, i) => {
          const state = states[i];
          const dot = DOT[state];
          const connector =
            state === "down" ? "border-brand" : state === "idle" ? "border-line" : "border-faint";
          const dashed = state === "idle" ? "border-dashed" : "border-solid";

          return (
            <div key={hop.id} className="flex items-center gap-0 sm:flex-1 sm:flex-col sm:items-center">
              {i > 0 && (
                <>
                  {/* vertical connector on mobile, horizontal on desktop */}
                  <span
                    aria-hidden
                    className={`ml-[31px] h-6 shrink-0 border-l-[3px] ${connector} ${dashed} sm:hidden`}
                  />
                  <span
                    aria-hidden
                    className={`hidden w-full border-t-[3px] ${connector} ${dashed} sm:block`}
                    style={{ marginTop: 31 }}
                  />
                </>
              )}

              <div className="flex items-center gap-3 sm:flex-col sm:gap-0 sm:text-center">
                <div className="relative shrink-0 sm:-mt-[31px]">
                  <div
                    className={`flex h-16 w-16 items-center justify-center rounded-[10px] border-[3px] bg-card text-xl ${TILE[state]}`}
                  >
                    {HOP_KIND_ICONS[hop.kind] ?? "●"}
                  </div>
                  {dot && (
                    <span
                      aria-hidden
                      className={`absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full border-[3px] border-card ${dot}`}
                    />
                  )}
                </div>

                <div className="min-w-0 sm:mt-2 sm:w-full sm:px-1">
                  <div className="truncate text-[13px] font-semibold text-ink">{hop.label}</div>
                  <div className="truncate text-[11.5px] text-muted">
                    {HOP_KIND_LABELS[hop.kind] ?? "Hop"}
                  </div>
                  <div className="truncate text-[11.5px] text-faint">
                    {state === "up"
                      ? hop.latencyMs != null
                        ? `${hop.latencyMs.toFixed(1)} ms`
                        : "online"
                      : state === "down"
                        ? "not responding"
                        : hop.librenmsDeviceId == null
                          ? "not monitored"
                          : "awaiting first check"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
