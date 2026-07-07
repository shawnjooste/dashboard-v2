"use client";

import { useActionState } from "react";
import { uploadDevicePhotos, type PhotoUploadResult } from "@/lib/actions/device-photos";
import {
  MAX_PHOTO_EDGE,
  MAX_REQUEST_BYTES,
  chunkBySize,
  fitWithin,
} from "@/lib/device-photo-helpers";

const FIELD =
  "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

/** Phone photos are routinely 4-12 MB but Vercel caps request bodies at
 *  4.5 MB (413 before the action runs), so we downscale in the browser first:
 *  longest edge 1920px, JPEG. Anything already small stays untouched. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= 1_000_000) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const { width, height } = fitWithin(bmp.width, bmp.height, MAX_PHOTO_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bmp, 0, 0, width, height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[a-z0-9]+$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file; // undecodable format — the size guard below still applies
  }
}

/** Client wrapper around the server action: shrink each photo, drop any that
 *  still can't fit in a request, then upload in batches that stay under the
 *  platform's body-size cap. */
async function prepareAndUpload(
  deviceId: string,
  _prev: PhotoUploadResult | null,
  formData: FormData,
): Promise<PhotoUploadResult> {
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: "Pick at least one image." };
  const caption = formData.get("caption");

  const shrunk = await Promise.all(files.map(shrink));
  const errors: string[] = [];
  const sendable = shrunk.filter((f) => {
    if (f.size > MAX_REQUEST_BYTES) {
      errors.push(`${f.name}: too large to upload even after compression.`);
      return false;
    }
    return true;
  });

  for (const chunk of chunkBySize(sendable, MAX_REQUEST_BYTES)) {
    const fd = new FormData();
    for (const f of chunk) fd.append("photos", f);
    if (typeof caption === "string") fd.append("caption", caption);
    const result = await uploadDevicePhotos(deviceId, null, fd);
    if (!result.ok) errors.push(result.error);
  }

  return errors.length ? { ok: false, error: errors.join(" ") } : { ok: true };
}

export function AddDevicePhotos({ deviceId }: { deviceId: string }) {
  const [state, formAction, pending] = useActionState<PhotoUploadResult | null, FormData>(
    prepareAndUpload.bind(null, deviceId),
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
