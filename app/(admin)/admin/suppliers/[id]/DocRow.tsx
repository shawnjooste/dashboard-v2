"use client";

import { useState } from "react";
import type { SupplierDoc, DocType } from "@/lib/views/suppliers";
import { DocActions } from "./DocActions";

const DOC_TYPE_LABEL: Record<DocType, string> = {
  quote: "Quote",
  price_list: "Price list",
  spec: "Spec sheet",
  invoice: "Invoice",
  other: "Other",
};

function fmtAmount(amount: number | null, currency: string): string | null {
  if (amount === null) return null;
  return `${currency} ${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
}
const today = () => new Date().toISOString().slice(0, 10);

export function DocRow({ d, supplierId }: { d: SupplierDoc; supplierId: string }) {
  const [open, setOpen] = useState(false);
  const expired = d.validUntil ? d.validUntil < today() : false;
  const amount = fmtAmount(d.amount, d.currency);

  return (
    <div className="border-b border-line-soft last:border-0">
      <div className="flex items-start gap-2.5 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? "Collapse" : "Expand"}
          className="mt-[3px] shrink-0 text-[11px] text-faint transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
        >
          ▶
        </button>
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-ink">{d.title}</span>
            <span className="rounded bg-line-soft px-1.5 py-0.5 text-[11px] text-ink-3">{DOC_TYPE_LABEL[d.docType]}</span>
            {expired && <span className="rounded bg-brand-tint px-1.5 py-0.5 text-[11px] font-semibold text-[#B01218]">Expired</span>}
          </div>
          {!open && (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
              {d.reference && <span>Ref {d.reference}</span>}
              {amount && <span className="font-medium text-ink-2">{amount}</span>}
              {d.validUntil && <span className={expired ? "text-brand" : ""}>valid to {d.validUntil}</span>}
              {!d.hasFile && <span className="italic text-faint">no file</span>}
            </div>
          )}
        </button>
        <DocActions docId={d.id} supplierId={supplierId} hasFile={d.hasFile} />
      </div>

      {open && (
        <div className="px-4 pb-3.5 pl-[34px]">
          <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[13px]">
            {d.reference && (
              <>
                <dt className="text-muted">Reference</dt>
                <dd className="text-ink-2">{d.reference}</dd>
              </>
            )}
            {amount && (
              <>
                <dt className="text-muted">Amount</dt>
                <dd className="font-medium text-ink-2">{amount}</dd>
              </>
            )}
            {d.docDate && (
              <>
                <dt className="text-muted">Date</dt>
                <dd className="text-ink-2">{d.docDate}</dd>
              </>
            )}
            {d.validUntil && (
              <>
                <dt className="text-muted">Valid until</dt>
                <dd className={expired ? "font-medium text-brand" : "text-ink-2"}>
                  {d.validUntil}
                  {expired ? " · expired" : ""}
                </dd>
              </>
            )}
            <dt className="text-muted">File</dt>
            <dd className="text-ink-2">{d.fileName ? `${d.fileName} ${fmtSize(d.fileSize)}` : "—"}</dd>
          </dl>
          {d.notes && <p className="mt-2.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{d.notes}</p>}
        </div>
      )}
    </div>
  );
}
