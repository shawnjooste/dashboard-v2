"use client";

import { useState } from "react";
import type { SupplierOption } from "@/lib/views/rfqs";
import { saveRfqSupplier } from "../actions";

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.3px] text-faint";
const FIELD =
  "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

/** Assign the RFQ's supplier. Choosing a known one fills in their address;
 *  "Someone else" lets you type a new one, which is saved to the supplier
 *  list so it's remembered next time. */
export function SupplierPicker({
  rfqId,
  suppliers,
  supplierName,
  supplierEmail,
  trackingToken,
}: {
  rfqId: string;
  suppliers: SupplierOption[];
  supplierName: string | null;
  supplierEmail: string | null;
  trackingToken: string | null;
}) {
  const known = supplierName ? suppliers.find((s) => s.name.toLowerCase() === supplierName.toLowerCase()) : undefined;
  const [choice, setChoice] = useState<string>(known ? known.name : supplierName ? "__other__" : "");
  const [email, setEmail] = useState<string>(supplierEmail ?? "");
  const [name, setName] = useState<string>(supplierName ?? "");
  const other = choice === "__other__";

  const pick = (value: string) => {
    setChoice(value);
    if (value === "__other__") {
      setName("");
      setEmail("");
      return;
    }
    const s = suppliers.find((x) => x.name === value);
    setName(s?.name ?? "");
    setEmail(s?.email ?? "");
  };

  return (
    <form action={saveRfqSupplier} className="space-y-3 px-4 py-3.5">
      <input type="hidden" name="rfq_id" value={rfqId} />
      <input type="hidden" name="supplier_name" value={other ? name : choice} />

      <label className="block">
        <span className={LABEL}>Supplier</span>
        <select value={choice} onChange={(e) => pick(e.target.value)} className={FIELD}>
          <option value="">— none —</option>
          {suppliers.map((s) => (
            <option key={s.name} value={s.name}>
              {s.name}
              {s.category ? ` · ${s.category}` : ""}
            </option>
          ))}
          <option value="__other__">Someone else…</option>
        </select>
      </label>

      {other && (
        <label className="block">
          <span className={LABEL}>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rectron"
            className={FIELD}
          />
        </label>
      )}

      <label className="block">
        <span className={LABEL}>Email</span>
        <input
          name="supplier_email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="pricing@supplier.co.za"
          className={FIELD}
        />
      </label>

      {trackingToken && (
        <div className="flex items-baseline justify-between gap-3">
          <span className={LABEL}>Thread tag</span>
          <span className="font-mono text-[12px] text-ink-3">RFQ-{trackingToken}</span>
        </div>
      )}

      <div className="flex justify-end">
        <button className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
          Save supplier
        </button>
      </div>
      <p className="text-[11.5px] text-faint">
        Saving only records the supplier — it doesn&rsquo;t email them.
      </p>
    </form>
  );
}
