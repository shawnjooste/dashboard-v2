import Link from "next/link";
import { getSupplierDetail, DOC_TYPE_LABEL, type SupplierDoc } from "@/lib/views/suppliers";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { updateSupplier } from "../actions";
import { UploadDocForm } from "./UploadDocForm";
import { DocActions } from "./DocActions";

const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";
const LABEL = "text-[11px] font-semibold uppercase tracking-[0.3px] text-faint";

function fmtAmount(amount: number | null, currency: string): string | null {
  if (amount === null) return null;
  return `${currency} ${amount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtSize(bytes: number | null): string {
  if (!bytes) return "";
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;
}
const today = () => new Date().toISOString().slice(0, 10);

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await getSupplierDetail(id);
  if (!s) {
    return (
      <p className="text-muted">
        Supplier not found. <Link href="/admin/suppliers" className="text-brand hover:text-brand-dark">← Suppliers</Link>
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={
          <Link href="/admin/suppliers" className="hover:text-ink">
            ← Suppliers
          </Link>
        }
        title={s.name}
        subtitle={s.category ?? undefined}
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          <Card>
            <CardHeader title="Documents" count={s.documents.length} />
            {s.documents.length === 0 ? (
              <div className="px-4 py-6 text-sm text-faint">No documents yet — upload the supplier&rsquo;s first quote below.</div>
            ) : (
              s.documents.map((d) => <DocRow key={d.id} d={d} supplierId={s.id} />)
            )}
          </Card>

          <Card>
            <CardHeader title="Add document" />
            <div className="px-4 py-4">
              <UploadDocForm supplierId={s.id} />
            </div>
          </Card>
        </div>

        <div className="lg:w-[320px] lg:shrink-0">
          <Card>
            <CardHeader title="Details" />
            <form action={updateSupplier} className="space-y-3 px-4 py-4">
              <input type="hidden" name="id" value={s.id} />
              <Field label="Name" name="name" defaultValue={s.name} required />
              <Field label="Category" name="category" defaultValue={s.category} />
              <Field label="Contact" name="contact_name" defaultValue={s.contactName} />
              <Field label="Email" name="email" defaultValue={s.email} />
              <Field label="Phone" name="phone" defaultValue={s.phone} />
              <Field label="Website" name="website" defaultValue={s.website} />
              <label className="block">
                <span className={LABEL}>Notes</span>
                <textarea name="notes" rows={3} defaultValue={s.notes ?? ""} className={FIELD} />
              </label>
              <div className="flex justify-end">
                <button className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink-2 hover:bg-line-soft">
                  Save
                </button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, name, defaultValue, required }: { label: string; name: string; defaultValue: string | null; required?: boolean }) {
  return (
    <label className="block">
      <span className={LABEL}>{label}</span>
      <input name={name} defaultValue={defaultValue ?? ""} required={required} className={FIELD} />
    </label>
  );
}

function DocRow({ d, supplierId }: { d: SupplierDoc; supplierId: string }) {
  const expired = d.validUntil ? d.validUntil < today() : false;
  const amount = fmtAmount(d.amount, d.currency);
  return (
    <div className="border-b border-line-soft px-4 py-3 last:border-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-ink">{d.title}</span>
            <span className="rounded bg-line-soft px-1.5 py-0.5 text-[11px] text-ink-3">{DOC_TYPE_LABEL[d.docType]}</span>
            {expired && <span className="rounded bg-brand-tint px-1.5 py-0.5 text-[11px] font-semibold text-[#B01218]">Expired</span>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
            {d.reference && <span>Ref {d.reference}</span>}
            {amount && <span className="font-medium text-ink-2">{amount}</span>}
            {d.docDate && <span>{d.docDate}</span>}
            {d.validUntil && <span className={expired ? "text-brand" : ""}>valid to {d.validUntil}</span>}
            {d.fileName && <span className="text-faint">{d.fileName} {fmtSize(d.fileSize)}</span>}
            {!d.hasFile && <span className="italic text-faint">no file attached</span>}
          </div>
          {d.notes && <div className="mt-1 text-xs text-ink-3">{d.notes}</div>}
        </div>
        <DocActions docId={d.id} supplierId={supplierId} hasFile={d.hasFile} />
      </div>
    </div>
  );
}
