import Link from "next/link";
import { getDeviceDetail } from "@/lib/views/devices";
import { getCurrentProfile } from "@/lib/auth/profile";
import { DeviceDetailView } from "@/components/DeviceDetailView";
import { DeviceDisposition } from "@/components/DeviceDisposition";
import { DevicePhotos } from "@/components/DevicePhotos";
import { PageHeader } from "@/components/ui";

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
  const [detail, me] = await Promise.all([getDeviceDetail(id), getCurrentProfile()]);
  const canEdit = me.authenticated && me.profile.role === "client_manager";

  if (!detail) {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumb={
            <Link href="/" className="hover:text-ink">
              ← Back
            </Link>
          }
          title="Computer not found"
          subtitle="We couldn't find this computer, or it isn't linked to your account."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/" className="inline-block text-[13px] text-muted hover:text-ink">
        ← Back
      </Link>
      <DeviceDetailView detail={detail} />
      <DeviceDisposition deviceId={id} canEdit={canEdit} />
      <DevicePhotos deviceId={id} isStaff={false} />
    </div>
  );
}
