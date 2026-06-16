import { LoginCard } from "./LoginCard";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <LoginCard linkError={error === "link"} />
    </main>
  );
}
