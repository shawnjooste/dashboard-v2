import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDeviceLinkRows } from "@/lib/views/device-link-data";
import { saveDeviceLinks } from "./actions";

export default async function LinkDevicesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: client }, { people, rows }] = await Promise.all([
    supabase.from("clients").select("name").eq("id", id).maybeSingle(),
    getDeviceLinkRows(id),
  ]);

  const suggested = rows.filter((r) => !r.personId && r.suggestedId).length;
  const save = saveDeviceLinks.bind(null, id);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/admin/clients/${id}/people`} className="text-sm text-blue-600 hover:underline">
          ← {client?.name ?? "Client"} people
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Link devices to people</h1>
        <p className="mt-1 text-sm text-gray-500">
          {rows.length} devices · {suggested} suggested from last login. Review and confirm — suggestions are never auto-applied.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-500">No devices for this client yet.</p>
      ) : (
        <form action={save} className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">Last login</th>
                  <th className="px-3 py-2">Person</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const selected = r.personId ?? r.suggestedId ?? "";
                  const isSuggestion = !r.personId && !!r.suggestedId;
                  return (
                    <tr key={r.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-3 py-2 font-medium">{r.hostname}</td>
                      <td className="px-3 py-2 text-gray-500">{r.lastUser ?? "—"}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <select
                            name={`dev_${r.id}`}
                            defaultValue={selected}
                            className="rounded border border-gray-300 px-2 py-1 text-sm"
                          >
                            <option value="">— Unlinked —</option>
                            {people.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} ({p.email})
                              </option>
                            ))}
                          </select>
                          {isSuggestion && (
                            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                              suggested
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Save links
          </button>
        </form>
      )}
    </div>
  );
}
