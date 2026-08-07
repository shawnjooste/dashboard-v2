import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { canAccess, toOverrides } from "@/lib/feature-access";
import { getAgreement } from "@/lib/views/agreements";
import { downloadAgreementPdf } from "@/lib/actions/agreements";
import { AgreementBody } from "@/components/AgreementBody";
import { Card, CardHeader, PageHeader, SecondaryLink } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { SignBlock } from "./SignBlock";

export default async function ClientAgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (!canAccess(me.profile.role, toOverrides(me.profile.feature_overrides), "agreements")) redirect("/");
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const { id } = await params;
  const a = await getAgreement(id);
  if (!a) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<SecondaryLink href="/agreements">← All agreements</SecondaryLink>}
        title={a.title}
        subtitle={`${a.reference} · from Rocking One`}
      />

      {a.status === "signed" && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-good-line bg-good-tint px-4 py-3">
          <span className="text-sm font-semibold text-good">
            Signed by {a.signerName} on {fmtDateTime(a.signedAt)}
          </span>
          {/* Always offered on a signed agreement — the PDF is rebuilt on
              demand if it was never stored. */}
          <form action={downloadAgreementPdf.bind(null, a.id)} className="ml-auto">
            <button
              type="submit"
              className="rounded-lg bg-ink px-3.5 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-black"
            >
              Download PDF
            </button>
          </form>
        </div>
      )}

      {a.status === "void" && (
        <div className="rounded-lg border border-line bg-line-soft px-4 py-3 text-sm text-muted">
          This agreement was withdrawn and no longer needs your signature.
          {a.voidReason ? ` ${a.voidReason}` : ""}
        </div>
      )}

      <Card>
        <div className="p-6 sm:p-8">
          <AgreementBody md={a.bodyMd} />
        </div>
      </Card>

      {a.status === "sent" && (
        <Card>
          <CardHeader title="Sign this agreement" />
          <div className="p-4 sm:p-6">
            <SignBlock agreementId={a.id} />
          </div>
        </Card>
      )}
    </div>
  );
}
