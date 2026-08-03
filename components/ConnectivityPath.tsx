import type { PathHop } from "@/lib/views/connectivity";
import {
  HOP_KIND_LABELS,
  HOP_STATUS_WORD,
  groupHops,
  groupStateOf,
  hopStateOf,
  pathSummary,
  type GroupState,
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
  up: "bg-good text-white border-good",
  down: "bg-brand text-white border-brand",
  idle: "bg-card text-faint border-line",
};
/** The rule entering a step, coloured by whether that step passes at all. */
const CONNECTOR: Record<GroupState, string> = {
  up: "bg-good",
  degraded: "bg-warn",
  down: "bg-brand",
  idle: "bg-line",
};

function elapsed(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000));
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d`;
}

/**
 * The route a client's traffic takes, step by step, with each step carrying its
 * own live status — so an outage shows *where* it is rather than only that it
 * exists. The footer states the conclusion in words: all clear, a leg lost on a
 * redundant step, or the fault isolated to a named step with everything
 * upstream confirmed passing.
 *
 * A step can hold more than one device (two routers off the same Mikrotik).
 * Those stack in one column and share a step number, because that is what they
 * are: one hop of the path with two legs. Losing one is a degraded step, never
 * a broken path — modelled as a flat chain, it would have condemned everything
 * drawn after it.
 *
 * Deliberately absent: per-segment latency and a summed end-to-end figure.
 * Every hop is probed independently from the same place, so differencing or
 * adding those numbers would invent measurements we never took. The one honest
 * end-to-end figure is the round trip to the final hop, and it is withheld
 * entirely when the path ends in parallel legs — there is no single "end".
 */
export function ConnectivityPath({ hops }: { hops: PathHop[] }) {
  if (hops.length === 0) return null;
  const nowMs = Date.now();
  const steps = groupHops(hops).map((legs) => {
    const states = legs.map((l) => hopStateOf(l, nowMs));
    return { legs, states, state: groupStateOf(states) };
  });
  const summary = pathSummary(hops, nowMs);
  const degraded = summary.degradedLabels;

  return (
    <div className="border-b border-line-soft">
      <div className="flex items-center gap-3 px-4 pb-2 pt-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-faint">Path</span>
        <span className="h-3 w-px bg-line" />
        <span className="text-[11px] uppercase tracking-[0.5px] text-faint">
          {steps.length} {steps.length === 1 ? "step" : "steps"} monitored end to end
        </span>
        {summary.e2eLatencyMs != null && (
          <span className="ml-auto text-[11.5px] font-semibold tabular-nums text-ink-3">
            E2E {summary.e2eLatencyMs.toFixed(1)} ms
          </span>
        )}
      </div>

      {/* Steps: a row of columns on desktop, stacked on mobile. A column holds
          one panel per leg. */}
      <div className="grid grid-cols-1 border-t border-line-soft sm:grid-flow-col sm:auto-cols-fr">
        {steps.map((step, si) => {
          const prev = si > 0 ? steps[si - 1].state : null;
          const dashed = step.state === "idle" || prev === "idle";

          return (
            <div key={step.legs[0].id} className="flex flex-col border-line-soft sm:border-l sm:first:border-l-0">
              {step.legs.map((hop, li) => {
                const state = step.states[li];
                return (
                  <div
                    key={hop.id}
                    className={`relative flex-1 px-4 pb-4 pt-3 ${PANEL[state]} ${
                      li > 0 ? (state === "down" ? "border-t border-white/25" : "border-t border-line-soft") : ""
                    }`}
                  >
                    {/* step number + icon + the rule joining this step to the last */}
                    <div className="flex items-center gap-3">
                      <span
                        className={`text-[34px] font-bold leading-none tracking-[-0.03em] tabular-nums ${GHOST[state]}`}
                      >
                        {String(si + 1).padStart(2, "0")}
                      </span>
                      {si > 0 && li === 0 && (
                        <span
                          aria-hidden
                          className={`hidden h-[3px] flex-1 sm:block ${CONNECTOR[step.state]} ${dashed ? "opacity-40" : ""}`}
                          style={
                            dashed
                              ? {
                                  backgroundImage:
                                    "repeating-linear-gradient(90deg, currentColor 0 6px, transparent 6px 12px)",
                                  backgroundColor: "transparent",
                                  color: "var(--color-line)",
                                }
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
                      {step.legs.length > 1 && ` · leg ${li + 1} of ${step.legs.length}`}
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
                );
              })}
            </div>
          );
        })}
      </div>

      {/* The conclusion, in words. A lost leg is a warning, not an outage. */}
      <div
        className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t px-4 py-3 ${
          summary.faultLabel
            ? "border-brand bg-brand text-white"
            : degraded.length
              ? "border-warn-line bg-warn-tint text-warn-ink"
              : "border-line-soft bg-card"
        }`}
      >
        <span className="text-[14px] font-bold uppercase tracking-[-0.01em]">
          {summary.faultLabel
            ? `Fault isolated — ${summary.faultLabel}`
            : degraded.length
              ? `Running a leg short — ${degraded.join(", ")}`
              : summary.allOperational
                ? "All hops operational"
                : "Partial visibility"}
        </span>
        <span
          className={`text-[12.5px] ${
            summary.faultLabel ? "text-white/85" : degraded.length ? "text-warn-ink/80" : "text-muted"
          }`}
        >
          {summary.faultLabel
            ? [
                summary.faultSince ? `stopped responding ${elapsed(summary.faultSince, nowMs)} ago` : "not responding",
                summary.upstreamPassing ? "everything upstream is passing" : null,
                "we can see it and we're on it",
              ]
                .filter(Boolean)
                .join(" · ")
            : degraded.length
              ? `${degraded.length === 1 ? "One leg" : `${degraded.length} legs`} of a redundant step stopped responding · traffic is still passing on the other · we can see it and we're on it`
              : summary.allOperational
                ? "Every hop responded on the last check"
                : "Some hops aren't monitored — the ones we watch are responding"}
        </span>
      </div>
    </div>
  );
}
