"use client";

import { useState, useTransition } from "react";
import { postIncident, postUpdate, resolveIncident } from "@/lib/actions/status";
import { INCIDENT_TYPES, TYPE_LABELS } from "@/lib/status-helpers";

const FIELD =
  "rounded-lg border border-line bg-canvas px-3 py-2 text-[13px] text-ink outline-none focus:border-faint";

/** Post a new incident. Scope 'clients' reveals the client picker. */
export function PostIncidentForm({ clients }: { clients: { id: string; name: string }[] }) {
  const [scope, setScope] = useState("global");
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (fd: FormData) => {
    setErr(null);
    start(async () => {
      try {
        await postIncident(fd);
        setOpen(false);
        setScope("global");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not post that");
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark"
      >
        + Post incident
      </button>
    );
  }

  return (
    <form action={submit} className="w-full space-y-3 rounded-xl border border-line bg-card p-4">
      <input
        name="title"
        required
        placeholder="What's wrong? e.g. Fibre down at GSR Law"
        className={`${FIELD} w-full`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <select name="type" defaultValue="outage" className={FIELD}>
          {INCIDENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} className={FIELD}>
          <option value="global">Everyone</option>
          <option value="clients">Specific clients</option>
        </select>
        {scope === "clients" && (
          <span className="text-[12.5px] text-muted">Ctrl/⌘-click to pick several</span>
        )}
      </div>
      {scope === "clients" && (
        <select name="client_ids" multiple size={8} className={`${FIELD} w-full`}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <textarea
        name="body"
        required
        rows={3}
        placeholder="First update — what's happening and what you're doing about it."
        className={`${FIELD} w-full`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
        >
          {pending ? "Posting…" : "Post"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[13px] font-semibold text-muted hover:text-ink"
        >
          Cancel
        </button>
        {err && <span className="text-[12.5px] font-medium text-brand">{err}</span>}
      </div>
    </form>
  );
}

/** Post an update to, or resolve, one active incident. */
export function IncidentControls({ incidentId }: { incidentId: string }) {
  const [mode, setMode] = useState<null | "update" | "resolve">(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (fd: FormData) => {
    setErr(null);
    const action = mode === "resolve" ? resolveIncident : postUpdate;
    start(async () => {
      try {
        await action(incidentId, fd);
        setMode(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not save that");
      }
    });
  };

  if (!mode) {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMode("update")}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors hover:bg-line-soft"
        >
          Post update
        </button>
        <button
          type="button"
          onClick={() => setMode("resolve")}
          className="rounded-md border border-line px-2.5 py-1 text-xs font-semibold text-ink-2 transition-colors hover:bg-line-soft"
        >
          Resolve
        </button>
      </div>
    );
  }

  return (
    <form action={submit} className="w-full space-y-2">
      <textarea
        name="body"
        rows={2}
        required={mode === "update"}
        placeholder={mode === "resolve" ? "How it was resolved (optional)" : "What's changed?"}
        className={`${FIELD} w-full`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-ink px-3 py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
        >
          {pending ? "Saving…" : mode === "resolve" ? "Resolve incident" : "Post update"}
        </button>
        <button
          type="button"
          onClick={() => setMode(null)}
          className="text-[12.5px] font-semibold text-muted hover:text-ink"
        >
          Cancel
        </button>
        {err && <span className="text-[12.5px] font-medium text-brand">{err}</span>}
      </div>
    </form>
  );
}
