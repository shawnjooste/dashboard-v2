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
      {/* Sticky and viewport-tall from md up: the status panel can run far
          past one screen, and vertically centring the form in a 2000px column
          would put the sign-in field below the fold. self-start stops the grid
          stretching it, which is what makes sticky work. */}
      <div className="flex items-center justify-center bg-card px-6 py-12 md:order-2 md:sticky md:top-0 md:h-dvh md:self-start md:py-6">
        <div className="w-full max-w-[360px]">
          <Image
            src={logo}
            alt="Rocking"
            width={150}
            height={29}
            priority
            className="h-[26px] w-auto"
          />
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[2px] text-faint">
            The Portal
          </p>
          <div className="mt-9">
            <LoginCard linkError={error === "link"} next={next} />
          </div>
        </div>
      </div>

      <div className="flex flex-col justify-center bg-[#141416] px-6 py-12 md:order-1 md:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-[480px]">
          <h1 className="text-[21px] font-bold tracking-[-0.3px] text-white">Network status</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-white/45">
            Live status of the Rocking network and the services we run on it. No sign-in needed.
          </p>
          <div className="mt-8 border-t border-white/10 pt-8">
            <PublicStatusPanel status={status} />
          </div>
        </div>
      </div>
    </main>
  );
}
