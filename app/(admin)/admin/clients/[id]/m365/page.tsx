import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getM365View } from "@/lib/views/m365";
import { M365View } from "@/components/M365View";

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
      <div>
        <Link href={`/admin/clients/${id}`} className="text-sm text-blue-600 hover:underline">
          ← {client?.name ?? "Client"}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Microsoft 365 — {client?.name ?? "Client"}</h1>
      </div>
      <M365View view={view} />
    </div>
  );
}
