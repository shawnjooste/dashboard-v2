"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteDevicePhoto } from "@/lib/actions/device-photos";

export function DeleteDevicePhoto({ photoId, deviceId }: { photoId: string; deviceId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const del = () => {
    if (!confirm("Delete this photo? It is removed permanently.")) return;
    start(async () => {
      await deleteDevicePhoto(photoId, deviceId);
      router.refresh();
    });
  };

  return (
    <button
      type="button"
      onClick={del}
      disabled={pending}
      title="Delete photo"
      className="text-faint hover:text-brand disabled:opacity-60"
    >
      Remove
    </button>
  );
}
