import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { resolveLandingPath } from "@/lib/auth/routing";
import { getVisibleDeviceHealth } from "@/lib/views/devices";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";
import { DeviceHealthCard } from "@/components/DeviceHealthCard";

export default async function AppHome() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  const path = resolveLandingPath({
    authenticated: true,
    role: me.profile.role,
    status: me.profile.status,
    hasClient: me.profile.client_id !== null,
    hasClaimedDevice: me.hasClaimedDevice,
  });
  if (path !== "/app") redirect(path);

  const devices = await getVisibleDeviceHealth();

  if (me.profile.role === "client_manager") {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Network overview</h1>
        <SummaryStrip summary={summarize(devices)} />
        <DeviceTable devices={devices} rowHref={(id) => `/devices/${id}`} />
      </div>
    );
  }

  // client_member — their claimed device(s)
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My machine</h1>
      {devices.length === 0 ? (
        <p className="text-gray-500">No machine is linked to your account yet.</p>
      ) : (
        devices.map((d) => (
          <div key={d.id} className="space-y-2">
            <DeviceHealthCard device={d} />
            <Link
              href={`/devices/${d.id}`}
              className="inline-block text-sm text-blue-600 hover:underline"
            >
              View details →
            </Link>
          </div>
        ))
      )}
    </div>
  );
}
