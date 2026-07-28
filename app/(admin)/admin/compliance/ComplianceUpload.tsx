"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { uploadComplianceDocument, type UploadResult } from "./actions";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-brand px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
    >
      {pending ? "Uploading…" : "Upload document"}
    </button>
  );
}

export function ComplianceUpload() {
  const [state, action] = useActionState<UploadResult | null, FormData>(uploadComplianceDocument, null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="space-y-3.5">
      <label className="block">
        <span className={LABEL}>Description</span>
        <input name="description" required placeholder="Bank confirmation letter" className={FIELD} />
      </label>
      <label className="block">
        <span className={LABEL}>PDF</span>
        <input
          name="document"
          type="file"
          accept=".pdf,application/pdf"
          required
          className="mt-1 w-full text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-canvas file:px-3 file:py-1.5 file:text-[13px] file:font-semibold file:text-ink-2"
        />
        <span className="mt-1 block text-[12px] text-muted">PDF only, up to 4 MB.</span>
      </label>

      {state && !state.ok && (
        <p className="rounded-md bg-brand-tint px-3 py-1.5 text-[13px] font-medium text-[#B01218]">{state.error}</p>
      )}
      {state?.ok && (
        <p className="rounded-md bg-[#E9F7EF] px-3 py-1.5 text-[13px] font-medium text-good">Document uploaded.</p>
      )}

      <SubmitButton />
    </form>
  );
}
