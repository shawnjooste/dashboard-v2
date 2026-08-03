import { Fragment } from "react";
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

const TILE_PX = 64;
// Half the tile, less half the 3px rule, so connectors meet the tiles' centre line.
const RULE_OFFSET = TILE_PX / 2 - 2;

function statusLine(hop: PathHop, state: HopState): string {
  if (state === "up") return hop.latencyMs != null ? `${hop.latencyMs.toFixed(1)} ms` : "online";
  if (state === "down") return "not responding";
  return hop.librenmsDeviceId == null ? "not monitored" : "awaiting first check";
}

/**
 * The route a client's traffic takes: internet → core → distribution → their
 * device. Tiles carry their own live status where the hop is monitored, so an
 * outage shows *where* it is. The connector into a hop goes dashed when that
 * hop isn't live — a link waiting to be plugged in reads as pending, not
 * broken.
 *
 * Layout: hops are fixed-width columns with flexible connectors between them,
 * so every tile sits on one baseline and the rules only ever span the gaps.
 */
export function ConnectivityPath({ hops }: { hops: PathHop[] }) {
  if (hops.length === 0) return null;
  const nowMs = Date.now();

  return (
    <div className="border-b border-line-soft px-4 py-4">
      <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-faint">Path</div>

      <div className="mt-3 flex flex-col sm:flex-row sm:items-start sm:justify-between">
        {hops.map((hop, i) => {
          const state = hopState(hop, nowMs);
          const dot = DOT[state];
          // A connector belongs to the hop it leads into, so it reflects that
          // hop's state: red into a dead hop, dashed into one not yet live.
          const tone = state === "down" ? "border-brand" : state === "idle" ? "border-line" : "border-faint";
          const dash = state === "idle" ? "border-dashed" : "border-solid";

          return (
            <Fragment key={hop.id}>
              {i > 0 && (
                <>
                  <span
                    aria-hidden
                    className={`ml-[30px] h-5 shrink-0 border-l-4 sm:hidden ${tone} ${dash}`}
                  />
                  <span
                    aria-hidden
                    className={`hidden min-w-6 flex-1 border-t-4 sm:block ${tone} ${dash}`}
                    style={{ marginTop: RULE_OFFSET }}
                  />
                </>
              )}

              <div className="flex items-center gap-3 sm:w-[112px] sm:shrink-0 sm:flex-col sm:gap-0 sm:text-center">
                <div className="relative shrink-0">
                  <div
                    className={`flex items-center justify-center rounded-[5px] border-4 bg-card text-xl ${TILE[state]}`}
                    style={{ height: TILE_PX, width: TILE_PX }}
                  >
                    {HOP_KIND_ICONS[hop.kind] ?? "●"}
                  </div>
                  {dot && (
                    <span
                      aria-hidden
                      className={`absolute -right-1.5 -top-1.5 h-[18px] w-[18px] rounded-full border-[3px] border-card ${dot}`}
                    />
                  )}
                </div>

                <div className="min-w-0 sm:mt-2 sm:w-full">
                  {/* fixed label box so one- and two-line names stay aligned */}
                  <div className="text-[13px] font-semibold leading-tight text-ink sm:flex sm:min-h-[34px] sm:items-start sm:justify-center">
                    {hop.label}
                  </div>
                  <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
                    {HOP_KIND_LABELS[hop.kind] ?? "Hop"}
                  </div>
                  <div className="text-[11.5px] leading-tight text-faint">{statusLine(hop, state)}</div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
