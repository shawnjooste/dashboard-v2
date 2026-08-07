"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { AgreementBody } from "@/components/AgreementBody";
import { createAgreement, updateDraft } from "@/lib/actions/agreements";

const LABEL = "text-xs font-semibold uppercase tracking-[0.4px] text-faint";
const FIELD =
  "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint";

export type EditorClient = { id: string; name: string };

/** Authoring surface for a draft. The preview renders through the very same
 *  parser the PDF uses, so what's previewed here is what gets signed. */
export function AgreementEditor({
  agreementId,
  clients,
  initialClientId,
  initialTitle = "",
  initialBody = "",
}: {
  agreementId?: string;
  clients?: EditorClient[];
  initialClientId?: string;
  initialTitle?: string;
  initialBody?: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);

  const action = agreementId ? updateDraft.bind(null, agreementId) : createAgreement;

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className={LABEL}>Title</span>
          <input
            name="title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Managed IT Services Agreement"
            className={FIELD}
          />
        </label>
        {clients && (
          <label className="block">
            <span className={LABEL}>Client</span>
            <select name="client_id" required defaultValue={initialClientId ?? ""} className={FIELD}>
              <option value="" disabled>
                Choose a client…
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="block">
          <span className={LABEL}>Agreement (markdown)</span>
          <textarea
            name="body_md"
            required
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={28}
            spellCheck
            placeholder={"# Managed IT Services Agreement\n\n## 1. Scope\n\n1. Rocking One will…"}
            className={`${FIELD} font-mono text-[13px] leading-relaxed`}
          />
          <span className="mt-1.5 block text-xs text-muted">
            Headings (#, ##, ###), bullets (-), numbered clauses (1.) and **bold** are supported. Your own
            clause numbers are kept exactly as typed.
          </span>
        </label>

        <div>
          <span className={LABEL}>Preview</span>
          <div className="mt-1 max-h-[640px] overflow-y-auto rounded-lg border border-line bg-card p-5">
            {body.trim() ? (
              <AgreementBody md={body} />
            ) : (
              <p className="text-sm text-muted">The agreement will appear here as you type.</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <SubmitButton editing={!!agreementId} />
        <span className="text-xs text-muted">
          Saving keeps it a draft — nothing reaches the client until you send it.
        </span>
      </div>
    </form>
  );
}

function SubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-ink px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-60"
    >
      {pending ? "Saving…" : editing ? "Save draft" : "Create draft"}
    </button>
  );
}
