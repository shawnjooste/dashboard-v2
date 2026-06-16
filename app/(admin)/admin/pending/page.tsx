import { createClient } from "@/lib/supabase/server";
import { ApprovalsView } from "./ApprovalsView";

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

  return <ApprovalsView pending={pending ?? []} clients={clients ?? []} />;
}
