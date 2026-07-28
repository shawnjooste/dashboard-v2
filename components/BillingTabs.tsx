import Link from "next/link";

const TABS = [
  { key: "invoices", label: "Invoices", href: "/billing" },
  { key: "company", label: "Company details", href: "/billing/company" },
  { key: "documents", label: "Documents", href: "/billing/documents" },
] as const;

export type BillingTab = (typeof TABS)[number]["key"];

export function BillingTabs({ active }: { active: BillingTab }) {
  return (
    <nav className="flex gap-1 border-b border-line">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={
            t.key === active
              ? "-mb-px border-b-2 border-brand px-3 py-2 text-sm font-semibold text-ink"
              : "-mb-px border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted hover:text-ink-2"
          }
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
