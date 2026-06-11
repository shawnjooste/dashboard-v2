import { type ReactNode } from "react";
import Link from "next/link";

/** Standard page header: breadcrumb, 30px title, optional red action, subtitle. */
export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  action,
}: {
  breadcrumb?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div>
      {breadcrumb && <div className="text-[13px] text-muted">{breadcrumb}</div>}
      <div className="mt-1.5 flex items-center gap-3.5">
        <h1 className="text-[30px] font-semibold tracking-[-0.5px] text-ink">{title}</h1>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {subtitle && <p className="mt-2 max-w-[640px] text-sm text-muted">{subtitle}</p>}
    </div>
  );
}

const PRIMARY =
  "inline-flex items-center rounded-lg bg-brand px-4 py-[9px] text-[13.5px] font-semibold text-white transition-colors hover:bg-brand-dark";

/** Red primary action as a link. */
export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={PRIMARY}>
      {children}
    </Link>
  );
}

/** Red primary action as a form submit button. */
export function PrimaryButton({
  children,
  type = "submit",
}: {
  children: ReactNode;
  type?: "submit" | "button";
}) {
  return (
    <button type={type} className={PRIMARY}>
      {children}
    </button>
  );
}

/** Secondary (outline) action as a link, e.g. "← All tickets". */
export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center rounded-lg border border-line px-3.5 py-2 text-[13px] font-semibold text-ink-2 transition-colors hover:bg-line-soft"
    >
      {children}
    </Link>
  );
}
