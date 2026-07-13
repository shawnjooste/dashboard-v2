import { createClient } from "@/lib/supabase/server";

export type Product = {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
};

export type ClientProduct = {
  id: string;
  productId: string;
  productName: string;
  productDescription: string | null;
  quantity: number;
  note: string | null;
};

/** The full catalog, staff view (active + archived), name order. */
export async function getProductCatalog(): Promise<Product[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select("id, name, description, is_active")
    .order("name");
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, description: p.description, isActive: p.is_active }));
}

/** Just the active catalog — for the "add product" picker. */
export async function getActiveProducts(): Promise<Product[]> {
  return (await getProductCatalog()).filter((p) => p.isActive);
}

/** A client's allocated products, joined with catalog name/description.
 *  RLS scopes this: staff see any client, a client's own users see only
 *  their own rows. */
export async function getClientProducts(clientId: string): Promise<ClientProduct[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("client_products")
    .select("id, product_id, quantity, note, products(name, description)")
    .eq("client_id", clientId);
  return (data ?? [])
    .map((r) => {
      const product = Array.isArray(r.products) ? r.products[0] : r.products;
      return {
        id: r.id,
        productId: r.product_id,
        productName: product?.name ?? "—",
        productDescription: product?.description ?? null,
        quantity: r.quantity,
        note: r.note,
      };
    })
    .sort((a, b) => a.productName.localeCompare(b.productName));
}
