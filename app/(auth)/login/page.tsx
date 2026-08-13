import { LoginCard } from "./LoginCard";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <LoginCard linkError={error === "link"} next={next} />
    </main>
  );
}
