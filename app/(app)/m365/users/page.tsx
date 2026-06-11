import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getM365Users } from "@/lib/views/m365";
import { M365UsersTable } from "@/components/M365UsersTable";
import { PageHeader } from "@/components/ui";

export default async function M365UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ license?: string }>;
}) {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const { license } = await searchParams;
  const users = await getM365Users(me.profile.client_id);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={
          <>
            <Link href="/" className="underline underline-offset-2 hover:text-ink">
              Account home
            </Link>{" "}
            ›{" "}
            <Link href="/m365" className="underline underline-offset-2 hover:text-ink">
              Microsoft 365
            </Link>{" "}
            › Users
          </>
        }
        title={license ?? "Licensed users"}
        subtitle={
          license
            ? `Everyone at your company holding a ${license} licence.`
            : "Everyone with a Microsoft 365 licence — what they have, and whether two-step sign-in is on."
        }
      />
      {license && (
        <Link href="/m365/users" className="inline-block text-[13px] font-semibold text-brand hover:text-brand-dark">
          ← All licensed users
        </Link>
      )}
      <M365UsersTable users={users} license={license} />
    </div>
  );
}
