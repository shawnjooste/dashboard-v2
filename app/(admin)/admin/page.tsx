import Link from "next/link";

export default function AdminHome() {
  return (
    <main className="p-8">
      <h1 className="text-xl font-semibold">Rocking admin</h1>
      <ul className="mt-4 list-disc pl-5">
        <li>
          <Link className="underline" href="/admin/pending">
            Pending user approvals
          </Link>
        </li>
      </ul>
      <p className="mt-4 text-gray-600">Client dashboards arrive in the next slice.</p>
      <form action="/auth/signout" method="post" className="mt-6">
        <button className="rounded border px-3 py-1 text-sm">Sign out</button>
      </form>
    </main>
  );
}
