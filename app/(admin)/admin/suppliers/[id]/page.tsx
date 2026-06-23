import Link from "next/link";
import { getSupplierDetail } from "@/lib/views/suppliers";
import { PageHeader, Card, CardHeader } from "@/components/ui";
import { updateSupplier } from "../actions";
import { AddDocDialog } from "./AddDocDialog";
import { DocRow } from "./DocRow";

const FIELD = "mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";
const LABEL = "text-[11px] font-semibold uppercase tracking-[0.3px] text-faint";

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
      <div className="flex items-start justify-between gap-3">
        <PageHeader
          breadcrumb={
            <Link href="/admin/suppliers" className="hover:text-ink">
              ← Suppliers
            </Link>
          }
          title={s.name}
          subtitle={s.category ?? undefined}
        />
        <AddDocDialog supplierId={s.id} />
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1 space-y-5">
          <Card>
            <CardHeader title="Documents" count={s.documents.length} />
            {s.documents.length === 0 ? (
              <div className="px-4 py-6 text-sm text-faint">No documents yet — use “+ Add document” to record the supplier&rsquo;s first quote.</div>
            ) : (
              s.documents.map((d) => <DocRow key={d.id} d={d} supplierId={s.id} />)
            )}
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
