import Link from "next/link";
import { getDeviceDetail } from "@/lib/views/devices";
import { DeviceDetailView } from "@/components/DeviceDetailView";

/**
 * Client-surface device detail. RLS does the scoping: a manager can only
 * fetch devices in their client, a member only their assigned machine(s) —
 * anything else comes back null.
 */
export default async function DevicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getDeviceDetail(id);

  if (!detail) {
    return (
      <div className="space-y-4">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Back
        </Link>
        <p className="text-gray-500">Device not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-blue-600 hover:underline">
        ← Back
      </Link>
      <DeviceDetailView detail={detail} />
    </div>
  );
}
