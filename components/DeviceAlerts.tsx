"use client";

import { useState } from "react";
import type { DeviceAlert } from "@/lib/views/devices";
import { Card, CardHeader } from "./ui/Card";

const fmt = (ts: string | null) => (ts ? ts.replace("T", " ").slice(0, 16) : "—");

/** Pretty-print the raw Datto alert context into readable key/value rows. */
function contextRows(ctx: Record<string, unknown> | null): { k: string; v: string }[] {
  if (!ctx) return [];
  const LABEL: Record<string, string> = {
    diskName: "Drive", freeSpace: "Free", totalVolume: "Total", unitOfMeasure: "Unit",
    type: "Type", eventId: "Event ID", source: "Source", logName: "Log",
  };
  const fmtKb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} GB`;
  const rows: { k: string; v: string }[] = [];
  for (const [key, val] of Object.entries(ctx)) {
    if (key === "@class" || val == null || typeof val === "object") continue;
    let v = String(val);
    if ((key === "freeSpace" || key === "totalVolume") && typeof val === "number") v = fmtKb(val);
    rows.push({ k: LABEL[key] ?? key, v });
  }
  return rows;
}

export function DeviceAlerts({ alerts }: { alerts: DeviceAlert[] }) {
  return (
    <Card>
      <CardHeader title="Recent alerts" count={alerts.length} />
      {alerts.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No alerts on record.</p>
      ) : (
        <ul>
          {alerts.map((a, i) => (
            <AlertRow key={i} a={a} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AlertRow({ a }: { a: DeviceAlert }) {
  const [open, setOpen] = useState(false);
  const rows = contextRows(a.context);
  const isHigh = a.priority === "High" || a.priority === "Critical";

  return (
    <li className="border-b border-line-soft last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-line-soft"
      >
        <span
          className="mt-[3px] shrink-0 text-[11px] text-faint transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
          aria-hidden
        >
          ▶
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            {a.alertType && (
              <span className="rounded bg-line-soft px-1.5 py-0.5 text-[11px] font-medium text-ink-3">{a.alertType}</span>
            )}
            <span className="text-sm font-medium text-ink">{a.message}</span>
          </span>
          <span className="mt-1 block text-xs text-muted">
            {fmt(a.triggeredAt)}
            {a.priority ? ` · ${a.priority}` : ""}
            {a.ticketNumber ? ` · ticket ${a.ticketNumber}` : ""}
          </span>
        </span>
        <span className={`shrink-0 text-xs font-semibold ${a.resolved ? "text-good" : isHigh ? "text-brand" : "text-warn-ink"}`}>
          {a.resolved ? "Resolved" : "Open"}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3.5 pl-[34px]">
          {a.message.length > 0 && (
            <p className="mb-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{a.message}</p>
          )}
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[13px]">
            {a.alertType && (<><dt className="text-muted">Type</dt><dd className="text-ink-2">{a.alertType}</dd></>)}
            <dt className="text-muted">Priority</dt><dd className="text-ink-2">{a.priority ?? "—"}</dd>
            <dt className="text-muted">Triggered</dt><dd className="text-ink-2">{fmt(a.triggeredAt)}</dd>
            <dt className="text-muted">Status</dt>
            <dd className={a.resolved ? "text-good" : "text-warn-ink"}>{a.resolved ? `Resolved ${a.resolvedAt ? `· ${fmt(a.resolvedAt)}` : ""}` : "Open"}</dd>
            {a.ticketNumber && (<><dt className="text-muted">Ticket</dt><dd className="text-ink-2">{a.ticketNumber}</dd></>)}
            {rows.map((r) => (
              <div key={r.k} className="contents">
                <dt className="text-muted">{r.k}</dt>
                <dd className="text-ink-2">{r.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </li>
  );
}
