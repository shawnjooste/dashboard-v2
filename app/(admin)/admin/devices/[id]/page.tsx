import Link from "next/link";
import { getDeviceDetail } from "@/lib/views/devices";
import { DeviceDetailView } from "@/components/DeviceDetailView";
import { createClient } from "@/lib/supabase/server";
import { suggestPerson } from "@/lib/views/device-link";
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
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">Person</h3>
      <form action={save} className="flex flex-wrap items-center gap-2">
        <select name="person_id" defaultValue={selected} className="rounded border border-gray-300 px-2 py-1 text-sm">
          <option value="">— Unlinked —</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.email})
            </option>
          ))}
        </select>
        {suggestion && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">suggested</span>
        )}
        <button type="submit" className="rounded-md bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700">
          Save
        </button>
      </form>
      {device.last_user && (
        <p className="mt-2 text-xs text-gray-500">Last login: {device.last_user}</p>
      )}
    </div>
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
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">
          ← All clients
        </Link>
        <p className="text-gray-500">Device not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/admin/clients/${detail.health.clientId}`}
        className="text-sm text-blue-600 hover:underline"
      >
        ← Back to fleet
      </Link>
      <DevicePersonCard deviceId={id} />
      <DeviceDetailView detail={detail} />
    </div>
  );
}
