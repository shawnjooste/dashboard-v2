import { createClient } from "@/lib/supabase/server";
import { approveUser } from "./actions";

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
    <main className="p-8">
      <h1 className="text-xl font-semibold">Pending user approvals</h1>
      {(!pending || pending.length === 0) && (
        <p className="mt-4 text-gray-600">No pending users.</p>
      )}
      <ul className="mt-6 space-y-4">
        {(pending ?? []).map((p) => (
          <li key={p.id} className="rounded border p-4">
            <div className="font-medium">{p.email}</div>
            <form action={approveUser} className="mt-3 flex flex-wrap items-center gap-3">
              <input type="hidden" name="profile_id" value={p.id} />
              <select name="client_id" required className="rounded border px-2 py-1">
                <option value="">Choose a client…</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" name="make_manager" /> Make manager
              </label>
              <button className="rounded bg-black px-3 py-1 text-sm text-white">
                Approve
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
