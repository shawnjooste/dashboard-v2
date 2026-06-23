"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobOwner } from "../actions";
import type { StaffOption } from "@/lib/views/jobs";

/** Owner = the admin responsible for the whole job (and BCC'd on its emails). Staff only. */
export function JobOwnerControl({
  jobId,
  ownerProfileId,
  staff,
}: {
  jobId: string;
  ownerProfileId: string | null;
  staff: StaffOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-3">
      <span className="text-xs font-semibold uppercase tracking-[0.4px] text-faint">Owner</span>
      <select
        value={ownerProfileId ?? ""}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await setJobOwner(jobId, e.target.value || null);
            router.refresh();
          })
        }
        className="ml-auto max-w-[200px] rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint disabled:opacity-60"
        aria-label="Job owner"
      >
        <option value="">Unassigned</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
