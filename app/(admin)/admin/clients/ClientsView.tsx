"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { clientColor, clientInitials } from "@/lib/ui/client-avatar";
import { setClientArchived } from "./actions";

export type ClientRow = {
  id: string;
  name: string;
  people: number;
  devices: number;
  attention: number;
  archived: boolean;
};

const RED = "#D7141C";
type Filter = "all" | "attention" | "healthy" | "nodevices" | "archived";

export function ClientsView({ clients }: { clients: ClientRow[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const active = useMemo(() => clients.filter((c) => !c.archived), [clients]);
  const archived = useMemo(() => clients.filter((c) => c.archived), [clients]);

  const counts = useMemo(
    () => ({
      all: active.length,
      attention: active.filter((c) => c.attention > 0).length,
      healthy: active.filter((c) => c.devices > 0 && c.attention === 0).length,
      nodevices: active.filter((c) => c.devices === 0).length,
      archived: archived.length,
    }),
    [active, archived],
  );

  const inArchived = filter === "archived";

  const rows = useMemo(() => {
    let r = inArchived ? archived.slice() : active.slice();
    if (filter === "attention") r = r.filter((c) => c.attention > 0);
    else if (filter === "healthy") r = r.filter((c) => c.devices > 0 && c.attention === 0);
    else if (filter === "nodevices") r = r.filter((c) => c.devices === 0);
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((c) => c.name.toLowerCase().includes(needle));
    r.sort((a, b) => {
      const cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [active, archived, inArchived, filter, q, sortDir]);

  const base = inArchived ? archived : active;

  const tiles: { key: Filter; label: string; value: number; dot: string; hot: boolean }[] = [
    { key: "all", label: "CLIENTS", value: counts.all, dot: "#18181B", hot: false },
    { key: "attention", label: "NEED ATTENTION", value: counts.attention, dot: RED, hot: counts.attention > 0 },
    { key: "healthy", label: "HEALTHY", value: counts.healthy, dot: "#15803D", hot: false },
    { key: "nodevices", label: "NO DEVICES", value: counts.nodevices, dot: "#B45309", hot: false },
    { key: "archived", label: "ARCHIVED", value: counts.archived, dot: "#94A3B8", hot: false },
  ];

  const cols = "grid-cols-[minmax(0,2.6fr)_96px_100px_136px_132px]";

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-[30px] font-bold tracking-[-0.6px] text-ink">Clients</h1>
            <span className="rounded-full border border-line bg-line-soft px-[11px] py-[3px] text-[13px] font-semibold text-ink-3">
              {active.length}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted">
            Every client — fleet size, devices needing attention and portal people.
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="mt-6 flex items-center gap-[11px] rounded-xl border border-line bg-card px-[18px] py-3.5 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
        <span className="text-[17px] text-faint">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${base.length} clients by name...`}
          className="flex-1 border-none bg-transparent text-[15px] text-ink outline-none"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ("")}
            className="rounded-md border border-line px-[9px] py-1 text-xs font-semibold text-muted hover:bg-line-soft"
          >
            Clear
          </button>
        )}
      </div>

      {/* Stat tiles / filters */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((t) => {
          const isActive = filter === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`rounded-[10px] border bg-card px-4 py-3.5 text-left transition-colors ${isActive ? "border-brand" : "border-line hover:border-faint"}`}
            >
              <span className="flex items-center gap-[7px]">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: t.dot }} />
                <span className="text-xs font-semibold tracking-[0.3px] text-muted">{t.label}</span>
              </span>
              <span className="mt-2 flex items-baseline gap-2">
                <span className="text-[26px] font-bold leading-none" style={{ color: t.hot ? t.dot : "#18181B" }}>
                  {t.value}
                </span>
                {isActive && <span className="text-xs font-semibold text-brand">Filtering</span>}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-line bg-card">
        <div className={`grid ${cols} items-center gap-3.5 border-b border-line-soft bg-[#FCFCFD] px-5 py-[11px]`}>
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="flex items-center gap-1.5 text-left text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint"
          >
            <span>Client</span>
            <span className="text-brand">{sortDir === "asc" ? "↑" : "↓"}</span>
          </button>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">People</div>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">Devices</div>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">Need attention</div>
          <div />
        </div>

        {rows.map((c) => (
          <div
            key={c.id}
            className={`grid ${cols} items-center gap-3.5 border-b border-line-soft px-5 py-3 last:border-0 hover:bg-[#FAFAFA] ${c.archived ? "opacity-75" : ""}`}
          >
            {/* Client */}
            <div className="flex min-w-0 items-center gap-3">
              <span
                className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ background: clientColor(c.name) }}
              >
                {clientInitials(c.name)}
              </span>
              <Link
                href={`/admin/clients/${c.id}`}
                className="min-w-0 truncate text-sm font-semibold text-ink hover:text-brand"
              >
                {c.name}
              </Link>
              {c.archived && (
                <span className="shrink-0 rounded bg-line-soft px-1.5 py-px text-[10.5px] font-semibold text-[#64748B]">
                  Archived
                </span>
              )}
            </div>
            {/* People */}
            <div className="text-[13px] text-ink-2">
              {c.people > 0 ? c.people : <span className="text-faint">—</span>}
            </div>
            {/* Devices */}
            <div className="text-[13px] text-ink-2">
              {c.devices > 0 ? c.devices : <span className="text-faint">none</span>}
            </div>
            {/* Need attention */}
            <div className="flex items-center gap-[7px]">
              {c.attention > 0 ? (
                <span className="rounded-full bg-brand-tint px-[11px] py-1 text-[12.5px] font-semibold text-[#B01218]">
                  {c.attention}
                </span>
              ) : c.devices > 0 ? (
                <>
                  <span className="h-[7px] w-[7px] rounded-full bg-good-dot" />
                  <span className="text-[12.5px] font-medium text-good">All good</span>
                </>
              ) : (
                <span className="text-[12.5px] text-faint">—</span>
              )}
            </div>
            {/* Archive / restore */}
            <div className="flex justify-end">
              <RowActions client={c} />
            </div>
          </div>
        ))}

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-[15px] font-semibold text-ink-3">
              {inArchived ? "No archived clients" : "No clients match your search"}
            </div>
            <div className="mt-[5px] text-[13.5px] text-faint">
              {inArchived ? "Archived clients show up here." : "Try a different name or filter."}
            </div>
            {!inArchived && (
              <button
                type="button"
                onClick={() => { setQ(""); setFilter("all"); }}
                className="mt-4 inline-flex rounded-lg border border-[#D4D4D8] px-4 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-ink hover:text-white"
              >
                Reset filters
              </button>
            )}
          </div>
        ) : (
          <div className="px-5 py-3 text-[12.5px] text-faint">
            Showing {rows.length} of {base.length} {inArchived ? "archived " : ""}clients
          </div>
        )}
      </div>
    </div>
  );
}

/** Per-row archive (with a confirm step) / restore control. */
function RowActions({ client }: { client: ClientRow }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const submit = (archived: boolean) => {
    const fd = new FormData();
    fd.set("client_id", client.id);
    fd.set("archived", String(archived));
    startTransition(async () => {
      await setClientArchived(fd);
    });
  };

  if (client.archived) {
    return (
      <button
        type="button"
        onClick={() => submit(false)}
        disabled={pending}
        className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors hover:bg-ink hover:text-white disabled:opacity-60"
      >
        {pending ? "…" : "Restore"}
      </button>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors hover:border-faint"
      >
        Archive
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => submit(true)}
        disabled={pending}
        className="rounded-md bg-ink px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
      >
        {pending ? "…" : "Confirm"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md border border-line px-2 py-1 text-xs font-semibold text-muted hover:bg-line-soft"
      >
        ✕
      </button>
    </span>
  );
}
