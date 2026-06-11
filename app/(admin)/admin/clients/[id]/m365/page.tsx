import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getM365View } from "@/lib/views/m365";
import { M365View } from "@/components/M365View";
import { PageHeader } from "@/components/ui";

export default async function AdminClientM365Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("name").eq("id", id).maybeSingle();
  const view = await getM365View(id);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <Link href={`/admin/clients/${id}`} className="hover:text-ink">
            ← {client?.name ?? "Client"}
          </Link>
        }
        title="Microsoft 365"
      />
      <M365View view={view} usersHref={`/admin/clients/${id}/m365/users`} />
    </div>
  );
}
