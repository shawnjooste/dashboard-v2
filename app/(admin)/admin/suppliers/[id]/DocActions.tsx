"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { supplierDocumentUrl, deleteSupplierDocument } from "../actions";

export function DocActions({ docId, supplierId, hasFile }: { docId: string; supplierId: string; hasFile: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const open = () => {
    // Open the tab synchronously (user gesture), then point it at the signed URL.
    const tab = window.open("about:blank", "_blank");
    start(async () => {
      const url = await supplierDocumentUrl(docId);
      if (!url) {
        tab?.close();
        return;
      }
      if (tab) tab.location.href = url;
      else window.location.href = url;
    });
  };

  const del = () => {
    if (!confirm("Delete this document? The file is removed permanently.")) return;
    start(async () => {
      await deleteSupplierDocument(docId, supplierId);
      router.refresh();
    });
  };

  return (
    <div className="flex shrink-0 items-center gap-2">
      {hasFile && (
        <button
          type="button"
          onClick={open}
          disabled={pending}
          className="rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-ink-2 hover:bg-line-soft disabled:opacity-60"
        >
          Open
        </button>
      )}
      <button
        type="button"
        onClick={del}
        disabled={pending}
        aria-label="Delete document"
        className="rounded-md border border-line px-2 py-1 text-[12px] text-faint hover:text-brand disabled:opacity-60"
      >
        ✕
      </button>
    </div>
  );
}
