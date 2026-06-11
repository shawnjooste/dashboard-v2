import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerson360 } from "@/lib/views/people";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function Person360Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const person = await getPerson360(id);
  if (!person) {
    return (
      <div className="space-y-4">
        <p className="text-muted">
          Person not found.{" "}
          <Link href="/admin" className="text-brand hover:text-brand-dark">
            ← Admin
          </Link>
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("name").eq("id", person.clientId).maybeSingle();

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href={`/admin/clients/${person.clientId}/people`} className="hover:text-ink">
            ← People · {client?.name ?? "Client"}
          </Link>
        }
        title={person.name}
        subtitle={person.email}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Microsoft 365" />
          <div className="px-4 py-3.5">
            {person.m365 ? (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Account</dt>
                  <dd className="font-medium text-ink-2">{person.m365.accountEnabled === false ? "Disabled" : "Enabled"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Licensed</dt>
                  <dd className="font-medium text-ink-2">{person.m365.licensed ? "Yes" : "No"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">MFA</dt>
                  <dd className={person.m365.licensed && !person.m365.mfaStrong ? "font-medium text-brand" : "font-medium text-ink-2"}>
                    {person.m365.mfaStrong ? person.m365.methods.join(", ") || "On" : "Password only"}
                  </dd>
                </div>
                {person.m365.licenses.length > 0 && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Licenses</dt>
                    <dd className="text-right font-medium text-ink-2">{person.m365.licenses.join(", ")}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-muted">No Microsoft 365 account linked.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Portal login" />
          <div className="px-4 py-3.5">
            {person.portal ? (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Role</dt>
                  <dd className="font-medium text-ink-2">{person.portal.role}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Status</dt>
                  <dd className="font-medium text-ink-2">{person.portal.status}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted">This person hasn&apos;t signed into the portal.</p>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Devices" count={person.devices.length} />
        <div className="px-4 py-3.5">
          {person.devices.length === 0 ? (
            <p className="text-sm text-muted">
              No devices linked.{" "}
              <Link href={`/admin/clients/${person.clientId}/link-devices`} className="text-brand hover:text-brand-dark">
                Link devices →
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-line-soft text-sm">
              {person.devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <Link href={`/admin/devices/${d.id}`} className="font-medium text-ink hover:text-brand">
                    {d.hostname}
                  </Link>
                  <span className="text-muted">{d.lastUser ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
