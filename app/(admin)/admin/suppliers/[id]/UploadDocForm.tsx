"use client";

import { useActionState, useEffect, useRef } from "react";
import { uploadSupplierDocument, type UploadResult } from "../actions";

const LABEL = "text-[11px] font-semibold uppercase tracking-[0.3px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

export function UploadDocForm({ supplierId, onSuccess }: { supplierId: string; onSuccess?: () => void }) {
  const [state, action, pending] = useActionState<UploadResult | null, FormData>(uploadSupplierDocument, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      onSuccess?.();
    }
  }, [state, onSuccess]);

  return (
    <form ref={formRef} action={action} className="space-y-3">
      <input type="hidden" name="supplier_id" value={supplierId} />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>Title</span>
          <input name="title" required placeholder="e.g. Cisco switch quote" className={FIELD} />
        </label>
        <label className="block">
          <span className={LABEL}>Type</span>
          <select name="doc_type" defaultValue="quote" className={FIELD}>
            <option value="quote">Quote</option>
            <option value="price_list">Price list</option>
            <option value="spec">Spec sheet</option>
            <option value="invoice">Invoice</option>
            <option value="other">Other</option>
          </select>
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="block">
          <span className={LABEL}>Reference</span>
          <input name="reference" placeholder="QU-1234" className={FIELD} />
        </label>
        <label className="block">
          <span className={LABEL}>Amount</span>
          <input name="amount" type="number" step="0.01" inputMode="decimal" className={FIELD} />
        </label>
        <label className="block">
          <span className={LABEL}>Currency</span>
          <input name="currency" defaultValue="ZAR" className={FIELD} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={LABEL}>Doc date</span>
          <input name="doc_date" type="date" className={FIELD} />
        </label>
        <label className="block">
          <span className={LABEL}>Valid until</span>
          <input name="valid_until" type="date" className={FIELD} />
        </label>
      </div>

      <label className="block">
        <span className={LABEL}>Notes</span>
        <textarea name="notes" rows={2} className={FIELD} />
      </label>

      <label className="block">
        <span className={LABEL}>File (optional — PDF, Excel/CSV, image, max 15 MB)</span>
        <input
          name="file"
          type="file"
          accept=".pdf,.xls,.xlsx,.csv,application/pdf,image/*"
          className="mt-1 w-full text-[13px] text-ink-2 file:mr-3 file:rounded-md file:border file:border-line file:bg-card file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-ink-2 hover:file:bg-line-soft"
        />
      </label>

      {state && !state.ok && (
        <p className="rounded-md bg-brand-tint px-3 py-1.5 text-[13px] font-medium text-[#B01218]">{state.error}</p>
      )}
      {state?.ok && (
        <p className="rounded-md bg-[#E9F7EF] px-3 py-1.5 text-[13px] font-medium text-good">Uploaded.</p>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save document"}
        </button>
      </div>
    </form>
  );
}
