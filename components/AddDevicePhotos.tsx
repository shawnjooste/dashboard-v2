"use client";

import { useActionState } from "react";
import { uploadDevicePhotos, type PhotoUploadResult } from "@/lib/actions/device-photos";

const FIELD =
  "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

export function AddDevicePhotos({ deviceId }: { deviceId: string }) {
  const [state, formAction, pending] = useActionState<PhotoUploadResult | null, FormData>(
    uploadDevicePhotos.bind(null, deviceId),
    null,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5">
      <input type="file" name="photos" accept="image/*" multiple required className={`${FIELD} min-w-0 flex-1`} />
      <input name="caption" placeholder="Caption (optional), e.g. Cracked hinge" className={`${FIELD} min-w-0 flex-1`} />
      <button
        disabled={pending}
        className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black disabled:opacity-50"
      >
        {pending ? "Uploading…" : "Add photos"}
      </button>
      {state && !state.ok && <p className="w-full text-xs text-brand">{state.error}</p>}
    </form>
  );
}
