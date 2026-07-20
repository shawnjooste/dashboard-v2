"use client";

import { useRef, useState, useTransition } from "react";
import type { GlobalPersonRow } from "@/lib/views/people";
import { FEATURES, FEATURE_LABELS, canAccess } from "@/lib/feature-access";
import { saveFeatureOverrides } from "./actions";

/** Staff-only per-user section access. Managers: checkboxes prefilled from
 *  role defaults minus overrides. Members are informational in v1 (nothing to
 *  grant — subtractive only). */
export function AccessEditor({ person }: { person: GlobalPersonRow }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const btn = useRef<HTMLButtonElement>(null);

  const role = person.portalRole;
  if (!person.profileId || (role !== "client_manager" && role !== "client_member")) return null;
  const isManager = role === "client_manager";
  const restricted = isManager && FEATURES.some((f) => !canAccess(role, person.featureOverrides, f));

  const submit = (fd: FormData) => {
    setErr(null);
    start(async () => {
      try {
        await saveFeatureOverrides(fd);
        setOpen(false);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not save access");
      }
    });
  };

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => {
          const r = btn.current?.getBoundingClientRect();
          if (r) setPos({ top: r.bottom + 6, left: Math.max(8, r.right - 208) });
          setOpen((o) => !o);
        }}
        title="Section access"
        className={`inline-flex items-center gap-1 rounded-full px-[11px] py-1 text-[12.5px] font-semibold transition-colors ${
          restricted ? "bg-warn-tint text-warn-ink hover:bg-[#F3E3C2]" : "bg-line-soft text-ink-3 hover:bg-line"
        }`}
      >
        Access
        <span className="text-[9px] opacity-50">▾</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            style={{ position: "fixed", top: pos.top, left: pos.left }}
            className="z-50 w-[208px] overflow-hidden rounded-lg border border-line bg-card shadow-[0_12px_32px_rgba(24,24,27,0.14)]"
          >
            <div className="border-b border-line-soft px-3 py-2">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.5px] text-faint">Section access</div>
              <div className="mt-0.5 text-[12.5px] text-ink-2">
                {isManager ? "Untick to hide a section" : "Members see the basics only"}
              </div>
            </div>
            <form action={submit} className="px-3 py-2">
              <input type="hidden" name="profile_id" value={person.profileId} />
              <input type="hidden" name="role" value={role} />
              {FEATURES.map((f) => (
                <label key={f} className="flex items-center gap-2 py-1 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    name={`f_${f}`}
                    defaultChecked={canAccess(role, person.featureOverrides, f)}
                    disabled={!isManager}
                  />
                  {FEATURE_LABELS[f]}
                </label>
              ))}
              {isManager && (
                <button
                  type="submit"
                  disabled={pending}
                  className="mt-2 w-full rounded-lg bg-ink px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-black disabled:opacity-60"
                >
                  {pending ? "Saving…" : "Save"}
                </button>
              )}
            </form>
            {err && <div className="border-t border-line-soft px-3 py-2 text-[12px] text-[#B01218]">{err}</div>}
          </div>
        </>
      )}
    </>
  );
}
