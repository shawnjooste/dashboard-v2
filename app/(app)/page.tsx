import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { resolveLandingPath } from "@/lib/auth/routing";
import { getVisibleDeviceHealth } from "@/lib/views/devices";
import { summarize } from "@/lib/views/health";
import { SummaryStrip } from "@/components/SummaryStrip";
import { DeviceTable } from "@/components/DeviceTable";
import { DeviceHealthCard } from "@/components/DeviceHealthCard";
import { PageHeader, SecondaryLink } from "@/components/ui";

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
        <PageHeader
          title="Overview"
          subtitle="A live look at the health of every computer across your company."
        />
        <SummaryStrip summary={summarize(devices)} />
        <DeviceTable devices={devices} rowHref={(id) => `/devices/${id}`} />
      </div>
    );
  }

  // client_member — their claimed device(s)
  return (
    <div className="space-y-6">
      <PageHeader
        title="My computer"
        subtitle="The current health of the computer linked to your account."
      />
      {devices.length === 0 ? (
        <p className="text-sm text-muted">
          No computer is linked to your account yet.
        </p>
      ) : (
        <div className="space-y-6">
          {devices.map((d) => (
            <div key={d.id} className="space-y-3">
              <DeviceHealthCard device={d} />
              <SecondaryLink href={`/devices/${d.id}`}>View details</SecondaryLink>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
