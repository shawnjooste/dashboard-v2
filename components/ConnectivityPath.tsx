import { Fragment } from "react";
import type { PathHop } from "@/lib/views/connectivity";
import {
  HOP_KIND_LABELS,
  HOP_STATUS_WORD,
  hopStateOf,
  pathSummary,
  type HopState,
} from "@/lib/connectivity-helpers";
import { HopIcon } from "@/components/HopIcon";

/** Panel styling per state. "Down" takes the whole panel red so a fault is
 *  unmissable; an unmonitored/stale hop stays neutral — it is not evidence of
 *  a problem, just an absence of data. */
const PANEL: Record<HopState, string> = {
  up: "bg-card text-ink",
  down: "bg-brand text-white",
  idle: "bg-canvas text-faint",
};
const GHOST: Record<HopState, string> = {
  up: "text-line",
  down: "text-white/25",
  idle: "text-line-soft",
};
const EYEBROW: Record<HopState, string> = {
  up: "text-muted",
  down: "text-white/75",
  idle: "text-faint",
};
const WORD: Record<HopState, string> = {
  up: "text-good",
  down: "text-white",
  idle: "text-faint",
};
const TILE: Record<HopState, string> = {
  up: "bg-ink text-white border-ink",
  down: "bg-brand text-white border-brand",
  idle: "bg-card text-faint border-line",
};

function elapsed(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000));
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d`;
}

/**
 * The route a client's traffic takes, hop by hop, with each step carrying its
 * own live status — so an outage shows *where* it is rather than only that it
 * exists. The footer states the conclusion in words: all clear, or the fault
 * isolated to a named hop with everything upstream confirmed passing.
 *
 * Deliberately absent: per-segment latency and a summed end-to-end figure.
 * Every hop is probed independently from the same place, so differencing or
 * adding those numbers would invent measurements we never took. The one
 * honest end-to-end figure is the round trip to the final hop.
 */
export function ConnectivityPath({ hops }: { hops: PathHop[] }) {
  if (hops.length === 0) return null;
  const nowMs = Date.now();
  const states = hops.map((h) => hopStateOf(h, nowMs));
  const summary = pathSummary(hops, nowMs);
  const faultHop = summary.faultIndex != null ? hops[summary.faultIndex] : null;

  return (
    <div className="border-b border-line-soft">
      <div className="flex items-center gap-3 px-4 pb-2 pt-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-faint">Path</span>
        <span className="h-3 w-px bg-line" />
        <span className="text-[11px] uppercase tracking-[0.5px] text-faint">
          {hops.length} hops monitored end to end
        </span>
        {summary.e2eLatencyMs != null && (
          <span className="ml-auto text-[11.5px] font-semibold tabular-nums text-ink-3">
            E2E {summary.e2eLatencyMs.toFixed(1)} ms
          </span>
        )}
      </div>

      {/* Hops: a row of panels on desktop, stacked on mobile. */}
      <div className="grid grid-cols-1 border-t border-line-soft sm:grid-flow-col sm:auto-cols-fr">
        {hops.map((hop, i) => {
          const state = states[i];
          const prev = i > 0 ? states[i - 1] : null;
          const connector =
            state === "down" ? "bg-brand" : state === "idle" || prev === "idle" ? "bg-line" : "bg-ink";
          const dashed = state === "idle" || prev === "idle";

          return (
            <Fragment key={hop.id}>
              <div className={`relative border-line-soft px-4 pb-4 pt-3 sm:border-l sm:first:border-l-0 ${PANEL[state]}`}>
                {/* index + icon + the rule that joins this hop to the previous */}
                <div className="flex items-center gap-3">
                  <span className={`text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums ${GHOST[state]}`}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {i > 0 && (
                    <span
                      aria-hidden
                      className={`hidden h-[3px] flex-1 sm:block ${connector} ${dashed ? "opacity-40" : ""}`}
                      style={
                        dashed
                          ? { backgroundImage: "repeating-linear-gradient(90deg, currentColor 0 6px, transparent 6px 12px)", backgroundColor: "transparent", color: "var(--color-line)" }
                          : undefined
                      }
                    />
                  )}
                  <span
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] border-2 ${TILE[state]} ml-auto sm:ml-0`}
                  >
                    <HopIcon kind={hop.kind} />
                  </span>
                </div>

                <div className={`mt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] ${EYEBROW[state]}`}>
                  {HOP_KIND_LABELS[hop.kind] ?? "Hop"}
                </div>
                <div className="mt-1 text-[19px] font-bold uppercase leading-tight tracking-[-0.01em]">
                  {hop.label}
                </div>
                <div className={`mt-1.5 text-[11.5px] font-bold uppercase tracking-[0.09em] ${WORD[state]}`}>
                  {HOP_STATUS_WORD[state]}
                  {state === "up" && hop.latencyMs != null && (
                    <span className={`ml-2 font-semibold tabular-nums ${EYEBROW[state]}`}>
                      {hop.latencyMs.toFixed(1)} ms
                    </span>
                  )}
                </div>
                {hop.detail && (
                  <div className={`mt-1.5 text-[12px] leading-snug ${EYEBROW[state]}`}>{hop.detail}</div>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>

      {/* The conclusion, in words. */}
      <div
        className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-4 py-3 ${
          faultHop ? "border-brand bg-brand text-white" : "border-line-soft bg-card"
        }`}
      >
        <span className="text-[14px] font-bold uppercase tracking-[-0.01em]">
          {faultHop ? `Fault isolated — ${faultHop.label}` : summary.allOperational ? "All hops operational" : "Partial visibility"}
        </span>
        <span className={`text-[12.5px] ${faultHop ? "text-white/85" : "text-muted"}`}>
          {faultHop
            ? [
                faultHop.lastCheckedAt ? `stopped responding ${elapsed(faultHop.lastCheckedAt, nowMs)} ago` : "not responding",
                summary.upstreamPassing ? "everything upstream is passing" : null,
                "we can see it and we're on it",
              ]
                .filter(Boolean)
                .join(" · ")
            : summary.allOperational
              ? "Every hop responded on the last check"
              : "Some hops aren't monitored — the ones we watch are responding"}
        </span>
      </div>
    </div>
  );
}
