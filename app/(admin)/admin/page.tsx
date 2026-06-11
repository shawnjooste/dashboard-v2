import { getClientSummaries } from "@/lib/views/clients";
import { getVisibleDeviceHealth } from "@/lib/views/devices";
import { ClientCard } from "@/components/ClientCard";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";
import { PageHeader } from "@/components/ui";

export default async function AdminHome() {
  const [clients, devices] = await Promise.all([getClientSummaries(), getVisibleDeviceHealth()]);
  const overall = summarize(devices);
  const attention = devices.filter((d) => d.needsAttention);

  return (
    <div className="space-y-6">
      <PageHeader title="Overview" />

      <SummaryStrip summary={overall} />

      <section>
        <h2 className="mt-8 mb-3.5 text-base font-bold text-ink">
          Needs attention now ({attention.length})
        </h2>
        <DeviceTable devices={attention} rowHref={(id) => `/admin/devices/${id}`} />
      </section>

      <section>
        <h2 className="mt-8 mb-3.5 text-base font-bold text-ink">
          Clients ({clients.length})
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clients.map((c) => (
            <ClientCard key={c.id} client={c} />
          ))}
        </div>
      </section>
    </div>
  );
}
