import Link from "next/link";
import { getClientDevices } from "@/lib/views/clients";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";
import { UsersSection } from "./UsersSection";

export default async function AdminClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { name, devices } = await getClientDevices(id);
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin" className="text-sm text-blue-600 hover:underline">
            ← All clients
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{name}</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/clients/${id}/people`}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            People →
          </Link>
          <Link
            href={`/admin/clients/${id}/m365`}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Microsoft 365 →
          </Link>
        </div>
      </div>
      <SummaryStrip summary={summarize(devices)} />
      <DeviceTable devices={devices} rowHref={(id) => `/admin/devices/${id}`} />
      <UsersSection clientId={id} />
    </div>
  );
}
