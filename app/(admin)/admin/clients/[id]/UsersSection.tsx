import { createClient } from "@/lib/supabase/server";
import { startImpersonation } from "./actions";

const ROLE_LABEL: Record<string, string> = {
  client_manager: "Manager",
  client_member: "Member",
};

export async function UsersSection({ clientId }: { clientId: string }) {
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("id, email, role, status")
    .eq("client_id", clientId)
    .order("email");

  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase text-gray-500">
        Users ({users?.length ?? 0})
      </h2>
      {!users || users.length === 0 ? (
        <p className="text-gray-500">No users have signed up for this client yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-3 py-2 font-medium">{u.email}</td>
                  <td className="px-3 py-2 text-gray-600">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td className="px-3 py-2 text-gray-600">{u.status}</td>
                  <td className="px-3 py-2 text-right">
                    {u.status === "active" && (
                      <form action={startImpersonation}>
                        <input type="hidden" name="profile_id" value={u.id} />
                        <button className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50">
                          Sign in as
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
