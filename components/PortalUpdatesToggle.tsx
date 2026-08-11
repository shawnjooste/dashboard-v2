"use client";

import { useState, useTransition } from "react";
import { setPortalUpdateOptOut } from "@/lib/actions/email-preferences";

/** Checkbox reading "send me these", stored as opt-OUT. Saves on change; the
 *  box reverts if the save fails so it never shows a preference we didn't
 *  persist. */
export function PortalUpdatesToggle({
  profileId,
  optedOut,
  label = "Send me portal updates",
}: {
  profileId: string;
  optedOut: boolean;
  label?: string;
}) {
  const [on, setOn] = useState(!optedOut);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const change = (next: boolean) => {
    setOn(next);
    setErr(null);
    start(async () => {
      try {
        await setPortalUpdateOptOut(profileId, !next);
      } catch (e) {
        setOn(!next);
        setErr(e instanceof Error ? e.message : "Could not save that");
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <label className="inline-flex items-center gap-2 text-[13px] text-ink">
        <input type="checkbox" checked={on} disabled={pending} onChange={(e) => change(e.target.checked)} />
        {label}
      </label>
      {err && <span className="text-[12px] text-brand">{err}</span>}
    </span>
  );
}
