import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getVisibleDeviceHealth } from "@/lib/views/devices";
import { getSampleDeviceHealth } from "@/lib/views/sample";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";
import { SampleBanner } from "@/components/SampleBanner";
import { PageHeader } from "@/components/ui";

export default async function DevicesPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "client_manager") redirect("/");

  let devices = await getVisibleDeviceHealth();
  let sample = false;
  if (devices.length === 0) {
    const s = await getSampleDeviceHealth();
    if (s.length > 0) {
      devices = s;
      sample = true;
    }
  }

  return (
    <div className="space-y-6">
      {sample && <SampleBanner />}
      <PageHeader
        breadcrumb={
          <Link href="/" className="underline underline-offset-2 hover:text-ink">
            Account home
          </Link>
        }
        title="Devices"
        subtitle="Every computer across your company — backups, updates and protection."
      />
      <SummaryStrip summary={summarize(devices)} />
      {/* Sample rows aren't clickable — there's no real device to drill into. */}
      <DeviceTable devices={devices} rowHref={sample ? undefined : (id) => `/devices/${id}`} />
    </div>
  );
}
