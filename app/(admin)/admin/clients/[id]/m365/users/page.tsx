import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getM365Users } from "@/lib/views/m365";
import { M365UsersTable } from "@/components/M365UsersTable";
import { PageHeader } from "@/components/ui";

export default async function AdminM365UsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ license?: string }>;
}) {
  const { id } = await params;
  const { license } = await searchParams;
  const supabase = await createClient();
  const [{ data: client }, users] = await Promise.all([
    supabase.from("clients").select("name").eq("id", id).maybeSingle(),
    getM365Users(id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href={`/admin/clients/${id}/m365`} className="hover:text-ink">
            ← Microsoft 365 · {client?.name ?? "Client"}
          </Link>
        }
        title={license ?? "Licensed users"}
        subtitle={
          license
            ? `Everyone holding a ${license} licence.`
            : "Everyone with a Microsoft 365 licence — what they have, and MFA status."
        }
      />
      {license && (
        <Link
          href={`/admin/clients/${id}/m365/users`}
          className="inline-block text-[13px] font-semibold text-brand hover:text-brand-dark"
        >
          ← All licensed users
        </Link>
      )}
      <M365UsersTable users={users} license={license} />
    </div>
  );
}
