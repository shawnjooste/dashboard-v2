import Link from "next/link";
import { getClientDevices } from "@/lib/views/clients";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";
import { UsersSection } from "./UsersSection";
import { PageHeader, SecondaryLink } from "@/components/ui";

export default async function AdminClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { name, devices } = await getClientDevices(id);
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href="/admin/clients" className="hover:text-ink">
            ← Clients
          </Link>
        }
        title={name}
        action={
          <div className="flex gap-2">
            <SecondaryLink href={`/admin/clients/${id}/people`}>People →</SecondaryLink>
            <SecondaryLink href={`/admin/clients/${id}/m365`}>Microsoft 365 →</SecondaryLink>
          </div>
        }
      />
      <SummaryStrip summary={summarize(devices)} />
      <DeviceTable devices={devices} rowHref={(id) => `/admin/devices/${id}`} />
      <UsersSection clientId={id} />
    </div>
  );
}
