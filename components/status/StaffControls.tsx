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

  const label = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark"
      >
        + Post incident
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 pt-[8vh]"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-line bg-card p-6 shadow-[0_24px_60px_rgba(24,24,27,0.22)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-ink">Post an incident</h2>
            <p className="mt-1 text-[13.5px] text-muted">
              Everyone affected sees this on the status page. Anyone subscribed gets an email straight away.
            </p>

            <form action={submit} className="mt-5 space-y-4">
              <label className="block">
                <span className={label}>Title</span>
                <input
                  name="title"
                  required
                  autoFocus
                  placeholder="What's wrong? e.g. Fibre down at GSR Law"
                  className={`${FIELD} mt-1 w-full`}
                />
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className={label}>Type</span>
                  <select name="type" defaultValue="outage" className={`${FIELD} mt-1 w-full`}>
                    {INCIDENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className={label}>Who sees it</span>
                  <select
                    name="scope"
                    value={scope}
                    onChange={(e) => setScope(e.target.value)}
                    className={`${FIELD} mt-1 w-full`}
                  >
                    <option value="global">Everyone</option>
                    <option value="clients">Specific clients</option>
                  </select>
                </label>
              </div>

              {scope === "clients" && (
                <label className="block">
                  <span className={label}>Affected clients</span>
                  <span className="ml-2 text-[12px] font-normal normal-case tracking-normal text-muted">
                    Ctrl/⌘-click to pick several
                  </span>
                  <select name="client_ids" multiple size={10} className={`${FIELD} mt-1 w-full`}>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block">
                <span className={label}>First update</span>
                <textarea
                  name="body"
                  required
                  rows={5}
                  placeholder="What's happening and what you're doing about it."
                  className={`${FIELD} mt-1 w-full`}
                />
              </label>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  disabled={pending}
                  className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
                >
                  {pending ? "Posting…" : "Post incident"}
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
          </div>
        </div>
      )}
    </>
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
