import Link from "next/link";
import { getDeviceDetail } from "@/lib/views/devices";
import { DeviceDetailView } from "@/components/DeviceDetailView";
import { createClient } from "@/lib/supabase/server";
import { suggestPerson } from "@/lib/views/device-link";
import { Card, CardHeader, PageHeader, PrimaryButton } from "@/components/ui";
import { setDevicePerson } from "./actions";

async function DevicePersonCard({ deviceId }: { deviceId: string }) {
  const supabase = await createClient();
  const { data: device } = await supabase
    .from("devices")
    .select("client_id, person_id, last_user, assigned_user_label")
    .eq("id", deviceId)
    .maybeSingle();
  if (!device) return null;

  const { data: peopleData } = await supabase
    .from("people")
    .select("id, email, display_name")
    .eq("client_id", device.client_id)
    .order("display_name");
  const people = (peopleData ?? []).map((p) => ({ id: p.id, email: p.email, name: p.display_name ?? p.email }));

  const suggestion = device.person_id
    ? null
    : suggestPerson({ lastUser: device.last_user, label: device.assigned_user_label }, people);
  const selected = device.person_id ?? suggestion?.person.id ?? "";
  const save = setDevicePerson.bind(null, deviceId);

  return (
    <Card>
      <CardHeader title="Person" />
      <div className="px-4 py-3.5">
        <form action={save} className="flex flex-wrap items-center gap-2">
          <select
            name="person_id"
            defaultValue={selected}
            className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-sm text-ink outline-none"
          >
            <option value="">— Unlinked —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.email})
              </option>
            ))}
          </select>
          {suggestion && (
            <span className="rounded-full bg-warn-tint px-2 py-0.5 text-xs font-medium text-warn-ink">
              suggested
            </span>
          )}
          <PrimaryButton>Save</PrimaryButton>
        </form>
        {device.last_user && (
          <p className="mt-2 text-xs text-muted">Last login: {device.last_user}</p>
        )}
      </div>
    </Card>
  );
}

export default async function AdminDevicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getDeviceDetail(id);

  if (!detail) {
    return (
      <div className="space-y-4">
        <p className="text-muted">
          Device not found.{" "}
          <Link href="/admin" className="text-brand hover:text-brand-dark">
            ← All clients
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href={`/admin/clients/${detail.health.clientId}`} className="hover:text-ink">
            ← Back to fleet
          </Link>
        }
        title={detail.health.hostname ?? "Device"}
      />
      <DevicePersonCard deviceId={id} />
      <DeviceDetailView detail={detail} />
    </div>
  );
}
