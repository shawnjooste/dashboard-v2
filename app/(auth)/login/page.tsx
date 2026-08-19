import Image from "next/image";
import logo from "@/public/rocking-logo.png";
import { getPublicStatus } from "@/lib/views/public-status";
import { PublicStatusPanel } from "@/components/status/PublicStatusPanel";
import { LoginCard } from "./LoginCard";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;
  const status = await getPublicStatus();

  return (
    // Form first in the DOM so a phone shows the thing people came for; the
    // status panel is ordered above it from md up.
    <main className="flex min-h-dvh flex-col md:grid md:grid-cols-[1.35fr_1fr]">
      <div className="flex items-center justify-center bg-card px-6 py-12 md:order-2 md:py-6">
        <LoginCard linkError={error === "link"} next={next} />
      </div>

      <div className="flex flex-col justify-center bg-[#141416] px-6 py-12 md:order-1 md:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-[480px]">
          <Image
            src={logo}
            alt="Rocking"
            width={150}
            height={29}
            priority
            className="h-[26px] w-auto"
          />
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[2px] text-white/35">
            The Portal
          </p>
          <div className="mt-10">
            <PublicStatusPanel status={status} />
          </div>
        </div>
      </div>
    </main>
  );
}
