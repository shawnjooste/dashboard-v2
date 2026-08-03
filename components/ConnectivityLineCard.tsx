import Link from "next/link";
import type { ReactNode } from "react";
import type { ConnectivityLine } from "@/lib/views/connectivity";
import { KIND_LABELS, CONN_TYPE_LABELS, linkState } from "@/lib/connectivity-helpers";
import { Card, StatusPill } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { RevealSecret } from "@/components/RevealSecret";
import { ConnectivityPath } from "@/components/ConnectivityPath";
import { fmtDateTime } from "@/lib/time";

const fmtWhen = fmtDateTime;

function ago(iso: string, nowMs: number): string {
  const mins = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function Setting({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2 text-[13px]">
      <span className="w-24 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-ink-2">{value}</span>
    </div>
  );
}

/** One line: what it is, how it's configured, and how it's doing. */
export function ConnectivityLineCard({ line }: { line: ConnectivityLine }) {
  const nowMs = Date.now();
  const state = linkState({ up: line.lastUp, lossPct: line.lossPct, lastCheckedAt: line.lastCheckedAt }, nowMs);
  const latencies = line.samples.map((s) => s.latencyMs).filter((n): n is number => n != null);

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="font-semibold text-ink">{line.label}</span>
            {line.librenmsDeviceId == null ? null : state === "stale" ? (
              <StatusPill
                tone="warn"
                label={line.lastCheckedAt ? `Last checked ${fmtWhen(line.lastCheckedAt)}` : "Not checked yet"}
              />
            ) : state === "up" ? (
              <StatusPill tone="good" label="Online" />
            ) : state === "degraded" ? (
              <StatusPill tone="warn" label={`Degraded · ${line.lossPct}% packet loss`} />
            ) : state === "down" ? (
              <StatusPill
                tone="bad"
                label={line.downSince ? `Down since ${fmtWhen(line.downSince)}` : "Not responding"}
              />
            ) : (
              <StatusPill tone="warn" label="Status unavailable" />
            )}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            {[KIND_LABELS[line.kind] ?? line.kind, line.speed, line.provider].filter(Boolean).join(" · ")}
          </p>
        </div>
        <Link
          href={`/support/new?subject=${encodeURIComponent(`Line problem: ${line.label}`)}`}
          className="ml-auto shrink-0 rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-line-soft"
        >
          Report a problem
        </Link>
      </div>

      {line.description && (
        <p className="border-b border-line-soft px-4 py-3 text-[13px] text-ink-2">{line.description}</p>
      )}

      <ConnectivityPath hops={line.hops} />

      <div className="grid gap-4 px-4 py-3.5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-faint">Connection</div>
          <Setting label="Type" value={CONN_TYPE_LABELS[line.connType] ?? line.connType} />
          {line.connType === "pppoe" && (
            <>
              <Setting label="Username" value={line.pppoeUsername ?? "—"} />
              <Setting label="Password" value={line.hasSecret ? <RevealSecret serviceId={line.id} /> : "—"} />
            </>
          )}
          {line.connType === "static" && (
            <>
              <Setting label="IP address" value={line.ipAddress ?? "—"} />
              <Setting label="Subnet mask" value={line.subnetMask ?? "—"} />
              <Setting label="Gateway" value={line.gateway ?? "—"} />
              <Setting label="DNS" value={line.dnsServers ?? "—"} />
            </>
          )}
          {line.vlan != null && <Setting label="VLAN" value={line.vlan} />}
        </div>

        {line.librenmsDeviceId != null && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.5px] text-faint">Health</div>
            <Setting
              label="Latency"
              value={line.latencyMs != null ? `${line.latencyMs.toFixed(1)} ms` : state === "down" ? "no response" : "—"}
            />
            {line.lossPct != null && line.lossPct > 0 && (
              <Setting label="Packet loss" value={`${line.lossPct}%`} />
            )}
            <Setting label="Checked" value={line.lastCheckedAt ? ago(line.lastCheckedAt, nowMs) : "—"} />
            {latencies.length >= 2 && (
              <div className="pt-1">
                <Sparkline values={latencies} width={200} height={32} />
                <p className="mt-1 text-[11px] text-faint">Latency, last 24 hours</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
