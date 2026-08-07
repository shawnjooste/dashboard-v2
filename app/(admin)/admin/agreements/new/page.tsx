import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getAgreementClients } from "@/lib/views/agreements";
import { PageHeader, SecondaryLink } from "@/components/ui";
import { AgreementEditor } from "../AgreementEditor";

export default async function NewAgreementPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const clients = await getAgreementClients();

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<SecondaryLink href="/admin/agreements">← All agreements</SecondaryLink>}
        title="New agreement"
        subtitle="Write the agreement here. It saves as a draft — only you can see it until you send it to the client."
      />
      <AgreementEditor clients={clients} />
    </div>
  );
}
