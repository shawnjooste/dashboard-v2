import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getAgreement, getAgreementRecipients } from "@/lib/views/agreements";
import { sendAgreement, voidAgreement, downloadAgreementPdf } from "@/lib/actions/agreements";
import { AgreementBody } from "@/components/AgreementBody";
import { Card, CardHeader, PageHeader, SecondaryLink } from "@/components/ui";
import { fmtDateTime } from "@/lib/time";
import { AgreementEditor } from "../AgreementEditor";
import { STATUS_LABEL, STATUS_STYLE } from "../status";

export default async function AgreementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentProfile();
  if (!me.authenticated || me.profile.role !== "rocking_staff") redirect("/");

  const { id } = await params;
  const a = await getAgreement(id);
  if (!a) notFound();

  const recipients = a.status === "draft" ? await getAgreementRecipients(a.clientId) : [];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={<SecondaryLink href="/admin/agreements">← All agreements</SecondaryLink>}
        title={a.title}
        subtitle={
          <>
            <span className="font-medium text-ink-2">{a.clientName}</span> · {a.reference} · created{" "}
            {fmtDateTime(a.createdAt)}
          </>
        }
        action={
          <span className={`rounded-full px-3 py-1 text-[12.5px] font-semibold ${STATUS_STYLE[a.status]}`}>
            {STATUS_LABEL[a.status] ?? a.status}
          </span>
        }
      />

      {a.status === "draft" && (
        <>
          <Card>
            <CardHeader title="Edit draft" />
            <div className="p-4">
              <AgreementEditor agreementId={a.id} initialTitle={a.title} initialBody={a.bodyMd} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Send for signature" />
            <div className="space-y-3 p-4">
              {recipients.length === 0 ? (
                <p className="text-sm text-warn-ink">
                  {a.clientName} has no active managers, so there is nobody who can sign this. Add a manager on
                  the client first.
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted">
                    Emails the agreement to {recipients.length === 1 ? "" : "each of "}
                    {recipients.map((email, i) => (
                      <span key={email}>
                        {i > 0 && (i === recipients.length - 1 ? " and " : ", ")}
                        <span className="font-medium text-ink-2">{email}</span>
                      </span>
                    ))}
                    . Any one of them can sign it. Once sent, the wording is locked.
                  </p>
                  <form action={sendAgreement.bind(null, a.id)}>
                    <button
                      type="submit"
                      className="rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark"
                    >
                      Send to {a.clientName}
                    </button>
                  </form>
                </>
              )}
            </div>
          </Card>
        </>
      )}

      {a.status !== "draft" && (
        <Card>
          <CardHeader
            title="Agreement"
            action={
              a.hasPdf ? (
                <form action={downloadAgreementPdf.bind(null, a.id)}>
                  <button type="submit" className="text-[13px] font-semibold text-brand hover:underline">
                    Download PDF
                  </button>
                </form>
              ) : undefined
            }
          />
          <div className="p-6">
            <AgreementBody md={a.bodyMd} />
          </div>
        </Card>
      )}

      {a.status === "sent" && (
        <>
          <Card>
            <CardHeader title="Status" />
            <p className="px-4 py-4 text-sm text-ink-2">
              Awaiting signature since {fmtDateTime(a.sentAt)}. Any active manager at {a.clientName} can sign it
              in their portal.
            </p>
          </Card>

          <Card>
            <CardHeader title="Void this agreement" />
            <form action={voidAgreement.bind(null, a.id)} className="space-y-3 p-4">
              <p className="text-sm text-muted">
                Voiding withdraws it from the client. Give a reason — it stays on the record.
              </p>
              <textarea
                name="void_reason"
                required
                rows={2}
                placeholder="e.g. Superseded by a revised scope"
                className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-faint"
              />
              <button
                type="submit"
                className="rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 hover:bg-line-soft"
              >
                Void agreement
              </button>
            </form>
          </Card>
        </>
      )}

      {a.status === "signed" && (
        <Card>
          <CardHeader title="Signature record" />
          <div className="grid gap-x-8 gap-y-3 p-4 text-sm sm:grid-cols-2">
            <Field label="Signed by" value={a.signerName ?? "—"} />
            <Field label="Email" value={a.signerEmail ?? "—"} />
            <Field label="Signed at" value={fmtDateTime(a.signedAt)} />
            <Field label="IP address" value={a.signerIp ?? "not captured"} />
          </div>
          <p className="border-t border-line-soft px-4 py-3 text-xs text-muted">
            This agreement is frozen. The wording and the signature cannot be changed by anyone, including us.
          </p>
        </Card>
      )}

      {a.status === "void" && a.voidReason && (
        <Card>
          <CardHeader title="Voided" />
          <p className="px-4 py-4 text-sm text-ink-2">{a.voidReason}</p>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.5px] text-faint">{label}</div>
      <div className="mt-0.5 text-ink-2">{value}</div>
    </div>
  );
}
