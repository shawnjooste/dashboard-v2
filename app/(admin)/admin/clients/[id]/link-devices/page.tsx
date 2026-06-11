import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getDeviceLinkRows } from "@/lib/views/device-link-data";
import { Card, PageHeader, PrimaryButton } from "@/components/ui";
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
      <PageHeader
        breadcrumb={
          <Link href={`/admin/clients/${id}/people`} className="hover:text-ink">
            ← {client?.name ?? "Client"} people
          </Link>
        }
        title="Link devices to people"
        subtitle={`${rows.length} devices · ${suggested} suggested from last login. Review and confirm — suggestions are never auto-applied.`}
      />

      {rows.length === 0 ? (
        <p className="text-muted">No devices for this client yet.</p>
      ) : (
        <form action={save} className="space-y-4">
          <Card>
            {rows.map((r) => {
              const selected = r.personId ?? r.suggestedId ?? "";
              const isSuggestion = !r.personId && !!r.suggestedId;
              return (
                <div
                  key={r.id}
                  className="flex items-center gap-3 border-b border-line-soft px-4 py-2.5 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-ink">{r.hostname}</div>
                    <div className="text-xs text-muted">{r.lastUser ?? "—"}</div>
                  </div>
                  {isSuggestion && (
                    <span className="rounded-full bg-warn-tint px-2 py-0.5 text-xs font-medium text-warn-ink">
                      suggested
                    </span>
                  )}
                  <select
                    name={`dev_${r.id}`}
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
                </div>
              );
            })}
          </Card>
          <PrimaryButton>Save links</PrimaryButton>
        </form>
      )}
    </div>
  );
}
