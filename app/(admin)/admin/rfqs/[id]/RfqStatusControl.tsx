"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRfqStatus } from "../actions";
import type { RfqStatus } from "@/lib/views/rfqs";

const STAGES: [RfqStatus, string][] = [
  ["new", "New"],
  ["sourcing", "Sourcing"],
  ["quoted", "Quoted"],
  ["won", "Won"],
];

export function RfqStatusControl({
  rfqId,
  status,
  sourcingNote,
  lostReason,
}: {
  rfqId: string;
  status: RfqStatus;
  sourcingNote: string | null;
  lostReason: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState(status === "lost" ? lostReason ?? "" : sourcingNote ?? "");

  const move = (s: RfqStatus, withNote: string | null) =>
    start(async () => {
      await setRfqStatus(rfqId, s, withNote);
      router.refresh();
    });

  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        {STAGES.map(([s, label]) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => move(s, s === "sourcing" ? note : null)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
              status === s ? "bg-ink text-white" : "border border-line text-ink-2 hover:bg-line-soft"
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={pending}
          onClick={() => move("lost", note)}
          className={`ml-auto text-[12px] ${status === "lost" ? "font-semibold text-brand" : "text-faint hover:text-brand"} disabled:opacity-60`}
        >
          {status === "lost" ? "Lost" : "Mark lost"}
        </button>
      </div>

      {(status === "sourcing" || status === "lost") && (
        <div className="mt-3 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={status === "sourcing" ? "Waiting on? (e.g. Jurumani costing)" : "Why lost? (optional)"}
            className="flex-1 rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => move(status, note)}
            className="rounded-lg border border-line px-3 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft disabled:opacity-60"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
