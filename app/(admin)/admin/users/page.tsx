import { createClient } from "@/lib/supabase/server";
import { getAllPeople } from "@/lib/views/people";
import { UsersView } from "./UsersView";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const { client: clientId } = await searchParams;
  const supabase = await createClient();
  const [{ data: clients }, people] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    getAllPeople(),
  ]);

  return (
    <UsersView
      people={people}
      clients={clients ?? []}
      initialClientId={clientId}
    />
  );
}
