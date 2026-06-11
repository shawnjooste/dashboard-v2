"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GlobalPersonRow } from "@/lib/views/people";
import { startImpersonation } from "@/app/(admin)/admin/clients/[id]/actions";

type ClientRef = { id: string; name: string };

const RED = "#D7141C";
const ALL_GRADIENT =
  "conic-gradient(#4F46E5 0 25%, #D7141C 0 50%, #0D9488 0 75%, #7C3AED 0 100%)";

const CLIENT_COLORS = [
  "#4F46E5", "#D7141C", "#0D9488", "#B45309", "#7C3AED",
  "#0E7490", "#BE185D", "#15803D", "#A16207", "#6D28D9",
];

// [bg, fg] pairs for person avatars, picked by name hash.
const AVATAR_PALETTE: [string, string][] = [
  ["#EEF2FF", "#4338CA"], ["#ECFDF5", "#047857"], ["#FEF2F2", "#B91C1C"],
  ["#FFF7ED", "#C2410C"], ["#F5F3FF", "#6D28D9"], ["#ECFEFF", "#0E7490"],
  ["#FDF2F8", "#BE185D"], ["#F0FDF4", "#15803D"], ["#FEFCE8", "#A16207"],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return h;
}

function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

/** "GSR Law" → "GSR" (leading acronym), "Harbour & Co" → "HC". */
function clientInitials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  if (words[0] && words[0].length <= 4 && words[0] === words[0].toUpperCase()) return words[0];
  return words.slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function clientColor(name: string): string {
  return CLIENT_COLORS[hash(name) % CLIENT_COLORS.length];
}

/** Shared/service mailboxes get a square avatar + "Account" tag. */
const ACCT_RE = /\b(accounts?|admin|service|services|mailbox|reception|dispatch|info|office|support|scan(ner)?|printer)\b/i;
function isAccount(p: GlobalPersonRow): boolean {
  return p.email.endsWith(".onmicrosoft.com") || ACCT_RE.test(p.name);
}

type Filter = "all" | "mfaoff" | "unlicensed" | "portal";

export function UsersView({
  people,
  clients,
  initialClientId,
}: {
  people: GlobalPersonRow[];
  clients: ClientRef[];
  initialClientId?: string;
}) {
  const [clientSel, setClientSel] = useState(initialClientId ?? "all");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [menuOpen, setMenuOpen] = useState(false);
  const [clientQ, setClientQ] = useState("");

  const countFor = (id: string) =>
    people.filter((p) => id === "all" || p.clientId === id).length;
  const mfaOffFor = (id: string) =>
    people.filter((p) => (id === "all" || p.clientId === id) && p.mfaStrong === false).length;

  const selClient = clientSel === "all" ? null : clients.find((c) => c.id === clientSel) ?? null;
  const selName = selClient?.name ?? "All clients";

  // ---- scope (client only) drives tiles, header count, search placeholder ----
  const scope = useMemo(
    () => people.filter((p) => clientSel === "all" || p.clientId === clientSel),
    [people, clientSel],
  );
  const scopeMfaOff = scope.filter((p) => p.mfaStrong === false).length;
  const scopeUnlic = scope.filter((p) => !p.licensed).length;
  const scopePortal = scope.filter((p) => p.portalRole).length;

  // ---- rows: status filter + search + sort ----
  const rows = useMemo(() => {
    let r = scope.slice();
    if (filter === "mfaoff") r = r.filter((p) => p.mfaStrong === false);
    else if (filter === "unlicensed") r = r.filter((p) => !p.licensed);
    else if (filter === "portal") r = r.filter((p) => p.portalRole);
    const needle = q.trim().toLowerCase();
    if (needle) r = r.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(needle));
    r.sort((a, b) => {
      const cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [scope, filter, q, sortDir]);

  const menuRows = [
    { id: "all", name: "All clients", initials: "", bg: ALL_GRADIENT, count: countFor("all"), mfaOff: mfaOffFor("all") },
    ...clients.map((c) => ({
      id: c.id,
      name: c.name,
      initials: clientInitials(c.name),
      bg: clientColor(c.name),
      count: countFor(c.id),
      mfaOff: mfaOffFor(c.id),
    })),
  ].filter((c) => !clientQ.trim() || c.name.toLowerCase().includes(clientQ.trim().toLowerCase()));

  const tiles: { key: Filter; label: string; value: number; dot: string; hot: boolean }[] = [
    { key: "all", label: "PEOPLE", value: scope.length, dot: "#18181B", hot: false },
    { key: "mfaoff", label: "MFA OFF", value: scopeMfaOff, dot: RED, hot: scopeMfaOff > 0 },
    { key: "unlicensed", label: "UNLICENSED", value: scopeUnlic, dot: "#B45309", hot: scopeUnlic > 0 },
    { key: "portal", label: "PORTAL ACCESS", value: scopePortal, dot: "#15803D", hot: false },
  ];

  const cols = "grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_120px_92px_124px_88px]";

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-[30px] font-bold tracking-[-0.6px] text-ink">Users</h1>
            <span className="rounded-full border border-line bg-line-soft px-[11px] py-[3px] text-[13px] font-semibold text-ink-3">
              {scope.length}
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted">
            {selClient
              ? `${selName} — licences, sign-in security and portal access.`
              : "Everyone across all clients — licences, sign-in security and portal access."}
          </p>
        </div>

        {/* Client switcher */}
        <div className="relative ml-auto shrink-0">
          <button
            type="button"
            onClick={() => { setMenuOpen((o) => !o); setClientQ(""); }}
            className="flex min-w-[230px] items-center gap-2.5 rounded-[10px] border border-line bg-card py-[7px] pl-2 pr-3 text-left transition-colors hover:border-faint"
          >
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-[inset_0_0_0_2px_#FFFFFF]"
              style={{ background: selClient ? clientColor(selClient.name) : ALL_GRADIENT }}
            >
              {selClient ? clientInitials(selClient.name) : ""}
            </span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[11px] font-medium text-faint">Viewing</span>
              <span className="block truncate text-sm font-semibold text-ink">{selName}</span>
            </span>
            <span className="ml-auto pl-1.5 text-[11px] text-faint">▾</span>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-[calc(100%+8px)] z-50 w-[340px] overflow-hidden rounded-xl border border-line bg-card shadow-[0_12px_32px_rgba(24,24,27,0.12)]">
                <div className="border-b border-line-soft p-2.5">
                  <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-[11px] py-2">
                    <span className="text-[13px] text-faint">⌕</span>
                    <input
                      value={clientQ}
                      onChange={(e) => setClientQ(e.target.value)}
                      placeholder="Find a client..."
                      autoFocus
                      className="flex-1 border-none bg-transparent text-[13.5px] text-ink outline-none"
                    />
                  </div>
                </div>
                <div className="max-h-[344px] overflow-auto p-1.5">
                  {menuRows.map((c) => {
                    const sel = clientSel === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { setClientSel(c.id); setMenuOpen(false); setClientQ(""); }}
                        className={`flex w-full items-center gap-[11px] rounded-lg px-2.5 py-[9px] text-left hover:bg-canvas ${sel ? "bg-[#FBF1F1]" : ""}`}
                      >
                        <span
                          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-[inset_0_0_0_2px_#FFFFFF]"
                          style={{ background: c.bg }}
                        >
                          {c.initials}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13.5px] font-semibold text-ink">{c.name}</span>
                          <span className={`mt-px block text-xs ${c.mfaOff > 0 ? "text-warn" : "text-good"}`}>
                            {c.mfaOff > 0 ? `${c.mfaOff} need MFA` : "All secured"}
                          </span>
                        </span>
                        <span className="ml-auto shrink-0 text-[12.5px] font-semibold text-faint">{c.count}</span>
                        <span className={`w-3.5 shrink-0 text-center text-sm font-bold text-brand ${sel ? "" : "invisible"}`}>✓</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="mt-6 flex items-center gap-[11px] rounded-xl border border-line bg-card px-[18px] py-3.5 shadow-[0_1px_2px_rgba(24,24,27,0.03)]">
        <span className="text-[17px] text-faint">⌕</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${scope.length} people by name or email...`}
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
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => {
          const active = filter === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setFilter(t.key)}
              className={`rounded-[10px] border bg-card px-4 py-3.5 text-left transition-colors ${active ? "border-brand" : "border-line hover:border-faint"}`}
            >
              <span className="flex items-center gap-[7px]">
                <span className="h-[7px] w-[7px] rounded-full" style={{ background: t.dot }} />
                <span className="text-xs font-semibold tracking-[0.3px] text-muted">{t.label}</span>
              </span>
              <span className="mt-2 flex items-baseline gap-2">
                <span className="text-[26px] font-bold leading-none" style={{ color: t.hot ? t.dot : "#18181B" }}>
                  {t.value}
                </span>
                {active && <span className="text-xs font-semibold text-brand">Filtering</span>}
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
            <span>Name</span>
            <span className="text-brand">{sortDir === "asc" ? "↑" : "↓"}</span>
          </button>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">Client</div>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">Microsoft 365</div>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">MFA</div>
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.6px] text-faint">Portal access</div>
          <div />
        </div>

        {rows.map((p) => {
          const acct = isAccount(p);
          const [avBg, avFg] = AVATAR_PALETTE[hash(p.name) % AVATAR_PALETTE.length];
          return (
            <div
              key={p.id}
              className={`grid ${cols} items-center gap-3.5 border-b border-line-soft px-5 py-3 last:border-0 hover:bg-[#FAFAFA]`}
            >
              {/* Person */}
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center text-xs font-bold ${acct ? "rounded-[9px]" : "rounded-full"}`}
                  style={{ background: acct ? "#F1F5F9" : avBg, color: acct ? "#475569" : avFg }}
                >
                  {personInitials(p.name)}
                </span>
                <span className="min-w-0">
                  <span className="flex min-w-0 items-center gap-2">
                    <Link
                      href={`/admin/people/${p.id}`}
                      className="min-w-0 truncate text-sm font-semibold text-ink hover:text-brand"
                    >
                      {p.name}
                    </Link>
                    {acct && (
                      <span className="shrink-0 rounded bg-[#F1F5F9] px-1.5 py-px text-[10.5px] font-semibold text-[#64748B]">
                        Account
                      </span>
                    )}
                  </span>
                  <span className="mt-px block truncate text-[12.5px] text-faint">{p.email}</span>
                </span>
              </div>
              {/* Client */}
              <div className="flex min-w-0 items-center gap-[9px]">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
                  style={{ background: clientColor(p.clientName) }}
                >
                  {clientInitials(p.clientName)}
                </span>
                <Link
                  href={`/admin/clients/${p.clientId}/people`}
                  className="truncate text-[13px] text-ink-2 hover:text-brand"
                >
                  {p.clientName}
                </Link>
              </div>
              {/* M365 */}
              <div>
                {p.hasM365 ? (
                  p.licensed ? (
                    <span className="rounded-full bg-line-soft px-[11px] py-1 text-[12.5px] font-semibold text-ink-3">Licensed</span>
                  ) : (
                    <span className="rounded-full bg-[#FEF6E7] px-[11px] py-1 text-[12.5px] font-semibold text-warn">Unlicensed</span>
                  )
                ) : (
                  <span className="text-[12.5px] text-faint">—</span>
                )}
              </div>
              {/* MFA */}
              <div className="flex items-center gap-[7px]">
                {p.mfaStrong === null ? (
                  <span className="text-[12.5px] text-faint">—</span>
                ) : p.mfaStrong ? (
                  <>
                    <span className="h-[7px] w-[7px] rounded-full bg-good-dot" />
                    <span className="text-[12.5px] font-medium text-good">On</span>
                  </>
                ) : (
                  <span className="rounded-full bg-brand-tint px-[11px] py-1 text-[12.5px] font-semibold text-[#B01218]">Off</span>
                )}
              </div>
              {/* Portal */}
              <div>
                {p.portalRole === "client_manager" ? (
                  <span className="rounded-full bg-brand-tint px-[11px] py-1 text-[12.5px] font-semibold text-[#B01218]">Manager</span>
                ) : p.portalRole === "client_member" ? (
                  <span className="rounded-full bg-line-soft px-[11px] py-1 text-[12.5px] font-semibold text-ink-3">Member</span>
                ) : p.portalRole ? (
                  <span className="rounded-full bg-line-soft px-[11px] py-1 text-[12.5px] font-semibold text-ink-3">{p.portalRole}</span>
                ) : (
                  <span className="text-[12.5px] text-line">—</span>
                )}
              </div>
              {/* View as */}
              <div className="text-right">
                {p.profileId && (
                  <form action={startImpersonation}>
                    <input type="hidden" name="profile_id" value={p.profileId} />
                    <button
                      type="submit"
                      className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors hover:bg-ink hover:text-white"
                    >
                      View as
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })}

        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-[15px] font-semibold text-ink-3">No one matches your search</div>
            <div className="mt-[5px] text-[13.5px] text-faint">Try a different name, email or filter.</div>
            <button
              type="button"
              onClick={() => { setQ(""); setFilter("all"); }}
              className="mt-4 inline-flex rounded-lg border border-[#D4D4D8] px-4 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-ink hover:text-white"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="px-5 py-3 text-[12.5px] text-faint">
            Showing {rows.length} of {scope.length}{" "}
            {clientSel === "all" ? "people across all clients" : "people"}
          </div>
        )}
      </div>
    </div>
  );
}
