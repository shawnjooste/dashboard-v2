import { getActiveProducts, getClientProducts } from "@/lib/views/products";
import { addClientProduct, removeClientProduct } from "@/lib/actions/products";
import { Card, CardHeader } from "@/components/ui";

const FIELD = "rounded-lg border border-line bg-canvas px-3 py-1.5 text-[13px] text-ink outline-none focus:border-faint";

/** Staff-only: the products/services this client has allocated to them. */
export async function ProductsSection({ clientId }: { clientId: string }) {
  const [catalog, allocated] = await Promise.all([getActiveProducts(), getClientProducts(clientId)]);
  const add = addClientProduct.bind(null, clientId);

  return (
    <Card>
      <CardHeader title="Products" count={allocated.length} />

      <form action={add} className="flex flex-wrap items-center gap-2 border-b border-line-soft px-4 py-3.5">
        <select name="product_id" required defaultValue="" className={FIELD}>
          <option value="" disabled>
            Pick a product…
          </option>
          {catalog.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input name="quantity" type="number" min="1" defaultValue={1} className={`${FIELD} w-20`} />
        <input name="note" placeholder="Note (optional)" className={`${FIELD} min-w-0 flex-1`} />
        <button className="rounded-lg bg-ink px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-black">
          Add
        </button>
      </form>

      {allocated.length === 0 ? (
        <p className="px-4 py-3.5 text-sm text-muted">No products allocated yet.</p>
      ) : (
        <ul>
          {allocated.map((a) => {
            const remove = removeClientProduct.bind(null, a.id, clientId);
            return (
              <li key={a.id} className="flex items-start gap-2.5 border-b border-line-soft px-4 py-3 last:border-0">
                <span className="mt-0.5 w-10 shrink-0 text-right font-medium text-ink">×{a.quantity}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{a.productName}</p>
                  {(a.productDescription || a.note) && (
                    <p className="mt-0.5 text-xs text-faint">
                      {a.productDescription}
                      {a.productDescription && a.note ? " · " : ""}
                      {a.note}
                    </p>
                  )}
                </div>
                <form action={remove} className="shrink-0">
                  <button className="text-xs text-faint hover:text-brand" title="Remove">
                    Remove
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
