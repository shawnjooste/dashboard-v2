import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getVisibleDeviceHealth } from "@/lib/views/devices";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";
import { PageHeader } from "@/components/ui";

export default async function DevicesPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "client_manager") redirect("/");

  const devices = await getVisibleDeviceHealth();

  return (
    <div className="space-y-6">
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
      <DeviceTable devices={devices} rowHref={(id) => `/devices/${id}`} />
    </div>
  );
}
