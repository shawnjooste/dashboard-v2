import { dotColour, statusLabel, TYPE_LABELS } from "@/lib/status-helpers";
import { fmtDateTime, fmtDate } from "@/lib/time";
import type { PublicStatus } from "@/lib/views/public-status";

/** Service status for people who aren't signed in — the left panel of the
 *  login page. Global incidents only; a visitor never learns which companies
 *  are affected by anything. Colours are literal because this sits on a fixed
 *  near-black panel, not on the themed app surfaces. */
export function PublicStatusPanel({ status }: { status: PublicStatus }) {
  const { worst, active, recent } = status;

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
        <>
          <p className="mt-1.5 text-[13px] text-white/45">No incidents reported.</p>
          {recent.length > 0 && (
            <>
              <p className="mt-8 text-[11px] font-semibold uppercase tracking-[1.5px] text-white/35">
                Recently resolved
              </p>
              <ul className="mt-2">
                {recent.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-baseline justify-between gap-4 border-b border-white/10 py-2 last:border-0"
                  >
                    <span className="text-[13px] text-white/70">{r.title}</span>
                    <span className="shrink-0 text-[12px] text-white/35">
                      {fmtDate(r.resolvedAt, "")}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : (
        <ul className="mt-5 space-y-5">
          {active.map((i) => (
            <li key={i.id} className="border-l-2 border-white/15 pl-3.5">
              <p className="text-[13.5px] font-semibold text-white">{i.title}</p>
              <p className="mt-0.5 text-[12px] text-white/40">
                {TYPE_LABELS[i.type] ?? i.type} · since {fmtDateTime(i.startedAt)}
              </p>
              {i.latest && (
                <>
                  <p className="mt-2.5 whitespace-pre-wrap text-[13px] leading-[1.55] text-white/75">
                    {i.latest.body}
                  </p>
                  <p className="mt-1.5 text-[11.5px] text-white/35">
                    updated {fmtDateTime(i.latest.createdAt)}
                  </p>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-9 text-[12px] text-white/35">
        Sign in for updates affecting your company.
      </p>
    </div>
  );
}
