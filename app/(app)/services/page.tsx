import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getClientProducts } from "@/lib/views/products";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export default async function ServicesPage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role !== "client_manager" || !me.profile.client_id) redirect("/");

  const products = await getClientProducts(me.profile.client_id);

  return (
    <div className="space-y-6">
      <PageHeader title="Services" subtitle="The products and services Rocking has set up for your account." />
      <Card>
        <CardHeader title="Your services" count={products.length} />
        {products.length === 0 ? (
          <p className="px-4 py-3.5 text-sm text-muted">Nothing here yet.</p>
        ) : (
          <ul>
            {products.map((p) => (
              <li key={p.id} className="flex items-start gap-2.5 border-b border-line-soft px-4 py-3 last:border-0">
                <span className="mt-0.5 w-10 shrink-0 text-right font-medium text-ink">×{p.quantity}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">{p.productName}</p>
                  {(p.productDescription || p.note) && (
                    <p className="mt-0.5 text-xs text-faint">
                      {p.productDescription}
                      {p.productDescription && p.note ? " · " : ""}
                      {p.note}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
