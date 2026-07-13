import { getProductCatalog } from "@/lib/views/products";
import { PageHeader } from "@/components/ui";
import { AddProductDialog } from "./AddProductDialog";
import { ProductsTable } from "./ProductsTable";

export default async function ProductsPage() {
  const products = await getProductCatalog();
  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="Products" subtitle="The catalog of services and licences clients can have allocated to their account." />
        <AddProductDialog />
      </div>
      <ProductsTable products={products} />
    </div>
  );
}
