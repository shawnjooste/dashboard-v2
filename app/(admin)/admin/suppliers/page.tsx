import { getSuppliers } from "@/lib/views/suppliers";
import { PageHeader } from "@/components/ui";
import { AddSupplierDialog } from "./AddSupplierDialog";
import { SuppliersTable } from "./SuppliersTable";

export default async function SuppliersPage() {
  const rows = await getSuppliers();
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Suppliers" subtitle="Supplier pricing and documents, for reference while quoting." />
        <AddSupplierDialog />
      </div>
      <SuppliersTable rows={rows} />
    </div>
  );
}
