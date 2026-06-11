import { createClient } from "@/lib/supabase/server";
import { approveUser } from "./actions";
import { PageHeader, Card, PrimaryButton } from "@/components/ui";

export default async function PendingApprovalsPage() {
  const supabase = await createClient();
  const [{ data: pending }, { data: clients }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    supabase.from("clients").select("id, name").order("name"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Pending user approvals" />
      {(!pending || pending.length === 0) && (
        <Card className="p-4">
          <p className="text-sm text-muted">No pending approvals.</p>
        </Card>
      )}
      <div className="space-y-4">
        {(pending ?? []).map((p) => (
          <Card key={p.id} className="p-4">
            <div className="text-sm font-medium text-ink">{p.email}</div>
            <form action={approveUser} className="mt-3 flex flex-wrap items-center gap-3">
              <input type="hidden" name="profile_id" value={p.id} />
              <select
                name="client_id"
                required
                aria-label="Client"
                className="rounded-lg border border-line bg-canvas px-3 py-2 text-[13.5px] text-ink outline-none"
              >
                <option value="">Choose a client…</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-sm text-ink-2">
                <input type="checkbox" name="make_manager" /> Make manager
              </label>
              <PrimaryButton>Approve</PrimaryButton>
            </form>
          </Card>
        ))}
      </div>
    </div>
  );
}
