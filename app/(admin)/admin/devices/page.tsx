import { createClient } from "@/lib/supabase/server";
import { getVisibleDeviceHealth } from "@/lib/views/devices";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";
import { PageHeader } from "@/components/ui";

/** Every Datto device across all clients (staff RLS sees all). */
export default async function AdminDevicesPage() {
  const devices = await getVisibleDeviceHealth();
  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("id, name");
  const nameById = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const clientName = (id: string) => nameById.get(id);

  // Needs-attention first, then by client, then hostname.
  const rows = [...devices].sort(
    (a, b) =>
      Number(b.needsAttention) - Number(a.needsAttention) ||
      (clientName(a.clientId) ?? "").localeCompare(clientName(b.clientId) ?? "") ||
      a.hostname.localeCompare(b.hostname),
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Devices" subtitle="Every Datto-managed device across all clients." />

      {devices.length === 0 ? (
        <p className="text-muted">
          No devices yet. Import a Datto report with
          <code className="mx-1 rounded bg-canvas px-1 text-ink-2">scripts/datto-pull.mjs</code>.
        </p>
      ) : (
        <>
          <SummaryStrip summary={summarize(devices)} />
          <DeviceTable devices={rows} clientName={clientName} />
        </>
      )}
    </div>
  );
}
