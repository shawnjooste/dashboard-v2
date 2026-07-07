import { getDevicePhotos } from "@/lib/views/device-photos";
import { Card, CardHeader } from "@/components/ui";
import { AddDevicePhotos } from "./AddDevicePhotos";
import { DeleteDevicePhoto } from "./DeleteDevicePhoto";

const fmt = (ts: string) => ts.replace("T", " ").slice(0, 16);

/** Photos of the device's physical state. Staff upload/delete; clients view. */
export async function DevicePhotos({ deviceId, isStaff }: { deviceId: string; isStaff: boolean }) {
  const photos = await getDevicePhotos(deviceId);
  if (!isStaff && photos.length === 0) return null; // nothing to show a client

  return (
    <Card>
      <CardHeader title="Photos" count={photos.length} />
      {isStaff && <AddDevicePhotos deviceId={deviceId} />}
      {photos.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No photos yet.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 px-4 py-3.5 sm:grid-cols-3 md:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className="min-w-0">
              {p.url ? (
                <a href={p.url} target="_blank" rel="noreferrer" title="Open full size">
                  {/* Signed URLs are per-render and expire hourly — next/image adds nothing here. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={p.url}
                    alt={p.caption ?? "Device photo"}
                    className="aspect-square w-full rounded-lg border border-line object-cover"
                  />
                </a>
              ) : (
                <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-line bg-canvas text-xs text-faint">
                  unavailable
                </div>
              )}
              {p.caption && <p className="mt-1 truncate text-xs text-ink-3" title={p.caption}>{p.caption}</p>}
              <p className="mt-0.5 flex items-center justify-between text-[11px] text-faint">
                <span>
                  {fmt(p.createdAt)}
                  {p.author ? <span className="capitalize"> · {p.author}</span> : ""}
                </span>
                {isStaff && <DeleteDevicePhoto photoId={p.id} deviceId={deviceId} />}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
