"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveCompanyDetails, type SaveResult } from "./actions";
import { FIELD_LABELS, type CompanyDetails } from "@/lib/company-details-helpers";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

const GROUPS: { title: string; fields: (keyof CompanyDetails)[] }[] = [
  { title: "Identity", fields: ["registered_name", "trading_name", "registration_number", "vat_number"] },
  { title: "Physical address", fields: ["physical_city", "physical_postal_code"] },
  { title: "Postal address", fields: ["postal_city", "postal_postal_code"] },
  { title: "Billing contact", fields: ["billing_contact_name", "billing_contact_email", "billing_contact_phone"] },
];

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save changes"}
    </button>
  );
}

export function CompanyDetailsForm({ details }: { details: CompanyDetails }) {
  const [state, action] = useActionState<SaveResult | null, FormData>(saveCompanyDetails, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-[10px] border border-line bg-card px-3.5 py-[9px] text-sm font-semibold text-ink-2 transition-colors hover:bg-line-soft"
        >
          Edit details
        </button>
        {state?.ok && (
          <span className="text-[13px] font-medium text-good">
            {state.changed === 0 ? "No changes to save." : `Saved — ${state.changed} field${state.changed === 1 ? "" : "s"} updated.`}
          </span>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">{g.title}</p>
          {g.title === "Physical address" && (
            <label className="mb-3 block">
              <span className={LABEL}>{FIELD_LABELS.physical_address}</span>
              <textarea name="physical_address" rows={3} defaultValue={details.physical_address ?? ""} className={FIELD} />
            </label>
          )}
          {g.title === "Postal address" && (
            <label className="mb-3 block">
              <span className={LABEL}>{FIELD_LABELS.postal_address}</span>
              <textarea name="postal_address" rows={3} defaultValue={details.postal_address ?? ""} className={FIELD} />
            </label>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {g.fields.map((f) => (
              <label key={f} className="block">
                <span className={LABEL}>{FIELD_LABELS[f]}</span>
                <input name={f} defaultValue={(details[f] as string | null) ?? ""} className={FIELD} />
              </label>
            ))}
          </div>
        </div>
      ))}

      <div>
        <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">Preferences</p>
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" name="po_required" defaultChecked={details.po_required} className="h-4 w-4" />
          {FIELD_LABELS.po_required}
        </label>
        <label className="mt-3 block">
          <span className={LABEL}>{FIELD_LABELS.billing_notes}</span>
          <textarea name="billing_notes" rows={3} defaultValue={details.billing_notes ?? ""} className={FIELD} />
        </label>
      </div>

      {state && !state.ok && (
        <p className="rounded-md bg-brand-tint px-3 py-1.5 text-[13px] font-medium text-[#B01218]">{state.error}</p>
      )}

      <div className="flex items-center gap-2">
        <SaveButton />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
