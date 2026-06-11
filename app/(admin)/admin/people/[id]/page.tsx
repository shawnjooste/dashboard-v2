import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getPerson360 } from "@/lib/views/people";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase text-gray-500">{title}</h3>
      {children}
    </div>
  );
}

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
        <Link href="/admin" className="text-sm text-blue-600 hover:underline">← Admin</Link>
        <p className="text-gray-500">Person not found.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("name").eq("id", person.clientId).maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/clients/${person.clientId}/people`} className="text-sm text-blue-600 hover:underline">
          ← People · {client?.name ?? "Client"}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{person.name}</h1>
        <p className="text-sm text-gray-500">{person.email}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Microsoft 365">
          {person.m365 ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">Account</dt><dd>{person.m365.accountEnabled === false ? "Disabled" : "Enabled"}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Licensed</dt><dd>{person.m365.licensed ? "Yes" : "No"}</dd></div>
              <div className="flex justify-between">
                <dt className="text-gray-500">MFA</dt>
                <dd className={person.m365.licensed && !person.m365.mfaStrong ? "font-medium text-red-600" : ""}>
                  {person.m365.mfaStrong ? person.m365.methods.join(", ") || "On" : "Password only"}
                </dd>
              </div>
              {person.m365.licenses.length > 0 && (
                <div className="flex justify-between gap-4"><dt className="text-gray-500">Licenses</dt><dd className="text-right">{person.m365.licenses.join(", ")}</dd></div>
              )}
            </dl>
          ) : (
            <p className="text-sm text-gray-500">No Microsoft 365 account linked.</p>
          )}
        </Card>

        <Card title="Portal login">
          {person.portal ? (
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-gray-500">Role</dt><dd>{person.portal.role}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-500">Status</dt><dd>{person.portal.status}</dd></div>
            </dl>
          ) : (
            <p className="text-sm text-gray-500">This person hasn&apos;t signed into the portal.</p>
          )}
        </Card>
      </div>

      <Card title="Devices">
        <p className="text-sm text-gray-500">Device linking arrives in the next slice.</p>
      </Card>
    </div>
  );
}
