import { dotColour, statusLabel, TYPE_LABELS } from "@/lib/status-helpers";
import { fmtDateTime, fmtDate } from "@/lib/time";
import type { PublicIncident, PublicStatus, PublicUpdate } from "@/lib/views/public-status";

/** Reverse-chronological updates. Each entry leads with its own timestamp and
 *  is divided by a rule — an update body runs to several paragraphs, and two
 *  of them stacked read as one wall of text otherwise. */
function Timeline({ updates }: { updates: PublicUpdate[] }) {
  if (updates.length === 0) return null;
  return (
    <ol className="mt-3 border-l-2 border-white/10 pl-3.5">
      {updates.map((u, idx) => (
        <li key={u.id} className={idx > 0 ? "mt-3.5 border-t border-white/10 pt-3.5" : ""}>
          <p className="text-[11.5px] font-semibold text-white/45">
            {fmtDateTime(u.createdAt)}
            {u.isResolution && <span className="ml-2 text-[#7CC243]">Resolved</span>}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-white/75">
            {u.body}
          </p>
        </li>
      ))}
    </ol>
  );
}

function ran(i: PublicIncident): string {
  const from = fmtDateTime(i.startedAt);
  const to = i.resolvedAt ? fmtDateTime(i.resolvedAt) : null;
  return to ? `${from} → ${to}` : `since ${from}`;
}

/** Service status for people who aren't signed in — the left panel of the
 *  login page. Global incidents only; a visitor never learns which companies
 *  are affected by anything. Colours are literal because this sits on a fixed
 *  near-black panel, not on the themed app surfaces. Past incidents use
 *  <details> so the timeline collapses without any client-side JavaScript. */
export function PublicStatusPanel({ status }: { status: PublicStatus }) {
  const { worst, active, past } = status;

  return (
    <div>
      <div className="flex items-center gap-2.5">
        <span
          className="h-[9px] w-[9px] shrink-0 rounded-full"
          style={{ background: dotColour(worst) }}
        />
        <span className="text-[15px] font-semibold text-white">{statusLabel(worst)}</span>
      </div>

      {active.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-white/45">No incidents reported.</p>
      ) : (
        <ul className="mt-5 space-y-6">
          {active.map((i) => (
            <li key={i.id}>
              <p className="text-[14px] font-semibold text-white">{i.title}</p>
              <p className="mt-0.5 text-[12px] text-white/40">
                {TYPE_LABELS[i.type] ?? i.type} · {ran(i)}
              </p>
              <Timeline updates={i.updates} />
            </li>
          ))}
        </ul>
      )}

      {past.length > 0 && (
        <>
          <p className="mt-9 text-[11px] font-semibold uppercase tracking-[1.5px] text-white/35">
            Past incidents
          </p>
          <ul className="mt-1">
            {past.map((i) => (
              <li key={i.id} className="border-b border-white/10 last:border-0">
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-baseline gap-3 py-2.5">
                    <span className="text-[13px] text-white/70 group-open:text-white">
                      {i.title}
                    </span>
                    <span className="ml-auto shrink-0 text-[11.5px] text-white/35">
                      {fmtDate(i.resolvedAt, "")}
                    </span>
                    <span className="shrink-0 text-[11px] text-white/30 group-open:rotate-90">
                      ›
                    </span>
                  </summary>
                  <div className="pb-3.5">
                    <p className="text-[11.5px] text-white/35">
                      {TYPE_LABELS[i.type] ?? i.type} · {ran(i)}
                    </p>
                    <Timeline updates={i.updates} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-9 text-[12px] text-white/35">
        Sign in for updates affecting your company.
      </p>
    </div>
  );
}
