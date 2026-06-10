import { type ReactNode } from "react";
import Image from "next/image";
import logo from "@/public/rocking-logo.png";

export function AppShell({
  email,
  roleLabel,
  children,
}: {
  email: string;
  roleLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <Image src={logo} alt="Rocking" priority className="h-7 w-auto" />
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              {roleLabel}
            </span>
          </div>
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>{email}</span>
            <form action="/auth/signout" method="post">
              <button className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
