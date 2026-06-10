import Link from "next/link";
import { getClientDevices } from "@/lib/views/clients";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";

export default async function AdminClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { name, devices } = await getClientDevices(id);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">
          ← All clients
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{name}</h1>
      </div>
      <SummaryStrip summary={summarize(devices)} />
      <DeviceTable devices={devices} />
    </div>
  );
}
