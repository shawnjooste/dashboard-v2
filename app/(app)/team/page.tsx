import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";

const ROLE_LABEL: Record<string, string> = {
  client_manager: "Manager",
  client_member: "Member",
};

export default async function TeamPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "client_manager") redirect("/");

  const supabase = await createClient();
  const { data: team } = await supabase
    .from("profiles")
    .select("id, email, role, status, created_at")
    .order("email");

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Team</h1>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {(team ?? []).map((p) => (
              <tr key={p.id} className="border-b border-gray-100 last:border-0">
                <td className="px-3 py-2 font-medium">{p.email}</td>
                <td className="px-3 py-2 text-gray-600">{ROLE_LABEL[p.role] ?? p.role}</td>
                <td className="px-3 py-2 text-gray-600">{p.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">
        Role management (invites, promotions) is coming soon.
      </p>
    </div>
  );
}
