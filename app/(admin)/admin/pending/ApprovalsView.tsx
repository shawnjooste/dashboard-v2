"use client";

import { useActionState, useState } from "react";
import { approveUser, rejectUser, type ApprovalResult } from "./actions";

type Pending = { id: string; email: string; created_at: string };
type ClientRef = { id: string; name: string };

function age(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

export function ApprovalsView({ pending, clients }: { pending: Pending[]; clients: ClientRef[] }) {
  return (
    <div className="space-y-0">
      <div className="flex items-center gap-3">
        <h1 className="text-[30px] font-bold tracking-[-0.6px] text-ink">Approvals</h1>
        <span className="rounded-full border border-line bg-line-soft px-[11px] py-[3px] text-[13px] font-semibold text-ink-3">
          {pending.length}
        </span>
      </div>
      <p className="mt-1.5 text-sm text-muted">
        People who&rsquo;ve signed in but aren&rsquo;t linked to a company yet — their email domain isn&rsquo;t recognised.
      </p>

      <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
        {pending.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-[15px] font-semibold text-ink-3">No one&rsquo;s waiting for approval</div>
            <div className="mt-[5px] text-[13.5px] text-faint">New signups from unrecognised domains show up here.</div>
          </div>
        ) : (
          pending.map((p) => <ApprovalRow key={p.id} person={p} clients={clients} />)
        )}
      </div>
    </div>
  );
}

function ApprovalRow({ person, clients }: { person: Pending; clients: ClientRef[] }) {
  const [appState, approve, appPending] = useActionState<ApprovalResult | null, FormData>(approveUser, null);
  const [rejState, reject, rejPending] = useActionState<ApprovalResult | null, FormData>(rejectUser, null);
  const [rejecting, setRejecting] = useState(false);

  const domain = person.email.split("@")[1] ?? "";
  const initials = person.email.slice(0, 2).toUpperCase();
  const error = (appState && !appState.ok && appState.error) || (rejState && !rejState.ok && rejState.error) || null;

  const ctrl =
    "rounded-lg border border-line bg-canvas px-3 py-2 text-[13.5px] text-ink outline-none focus:border-faint";

  return (
    <div className="border-b border-line-soft px-5 py-4 last:border-0">
      <div className="flex items-start gap-3">
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[#F1F5F9] text-xs font-bold text-[#475569]">
          {initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">{person.email}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px]">
            <span className="rounded-full bg-[#FEF6E7] px-2 py-px font-semibold text-[#8A4B0A]">
              @{domain} · not linked to a company
            </span>
            <span className="text-faint">waiting {age(person.created_at)}</span>
          </div>
        </div>
      </div>

      {!rejecting ? (
        <form action={approve} className="mt-3 flex flex-wrap items-center gap-2.5 pl-[46px]">
          <input type="hidden" name="profile_id" value={person.id} />
          <select name="client_id" required aria-label="Company" defaultValue="" className={ctrl}>
            <option value="" disabled>Choose a company…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select name="role" aria-label="Role" defaultValue="client_member" className={ctrl}>
            <option value="client_member">Member</option>
            <option value="client_manager">Manager</option>
          </select>
          <button
            type="submit"
            disabled={appPending}
            className="rounded-lg bg-brand px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
          >
            {appPending ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-line-soft"
          >
            Reject
          </button>
          <label className="flex w-full items-center gap-1.5 text-[12.5px] text-muted">
            <input type="checkbox" name="link_domain" className="h-3.5 w-3.5" />
            Also let anyone from <span className="font-semibold text-ink-2">@{domain}</span> join this company automatically
          </label>
        </form>
      ) : (
        <form action={reject} className="mt-3 flex flex-wrap items-center gap-2.5 pl-[46px]">
          <input type="hidden" name="profile_id" value={person.id} />
          <input
            name="reason"
            placeholder="Reason (optional, for your records)"
            className={`${ctrl} min-w-[260px] flex-1`}
          />
          <button
            type="submit"
            disabled={rejPending}
            className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
          >
            {rejPending ? "Rejecting…" : "Confirm reject"}
          </button>
          <button
            type="button"
            onClick={() => setRejecting(false)}
            className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-line-soft"
          >
            Cancel
          </button>
        </form>
      )}

      {error && <p className="mt-2 pl-[46px] text-[13px] font-medium text-brand">{error}</p>}
    </div>
  );
}
