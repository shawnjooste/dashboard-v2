import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/profile";
import {
  PageHeader,
  Card,
  CardHeader,
  Avatar,
  StatusBadge,
  type Health,
} from "@/components/ui";

const ROLE_LABEL: Record<string, string> = {
  client_manager: "Manager",
  client_member: "Member",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  pending: "Pending",
  rejected: "Declined",
};

function statusTone(status: string): Health {
  if (status === "active") return "good";
  if (status === "rejected") return "bad";
  return "warn";
}

export default async function TeamPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "client_manager") redirect("/");

  const supabase = await createClient();
  const { data: team } = await supabase
    .from("profiles")
    .select("id, email, role, status, created_at")
    .order("email");

  const members = team ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Your team"
        subtitle="Everyone from your company who has access to this portal."
      />
      <Card>
        <CardHeader title="People" count={members.length} />
        <table className="w-full text-sm">
          <thead className="border-b border-line-soft text-left text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Name</th>
              <th className="px-4 py-2.5 font-semibold">Role</th>
              <th className="px-4 py-2.5 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {members.map((p) => (
              <tr
                key={p.id}
                className="border-b border-line-soft last:border-0 hover:bg-canvas"
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={p.email} size="sm" />
                    <span className="font-medium text-ink">{p.email}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-ink-3">
                  {ROLE_LABEL[p.role] ?? p.role}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge
                    tone={statusTone(p.status)}
                    label={STATUS_LABEL[p.status] ?? p.status}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-[13px] text-muted">
        Inviting people and changing roles is coming soon.
      </p>
    </div>
  );
}
