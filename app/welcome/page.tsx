import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";
import { WelcomeForm } from "./WelcomeForm";

/** One-time first-login step: capture the user's name. Lives outside the (app)
 *  route group so the layout's name-gate can't loop back onto it. */
export default async function WelcomePage() {
  const me = await getCurrentProfile();
  if (!me.authenticated) redirect("/login");
  if (me.profile.role === "rocking_staff") redirect("/admin");
  if (!me.profile.client_id || !me.profile.person_id) redirect("/");

  const supabase = await createClient();
  const { data: person } = await supabase
    .from("people")
    .select("first_name")
    .eq("id", me.profile.person_id)
    .maybeSingle();
  if (person?.first_name) redirect("/"); // already named — nothing to do

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-card p-7 shadow-[0_24px_60px_rgba(24,24,27,0.10)]">
        <h1 className="text-[22px] font-bold tracking-[-0.4px] text-ink">Welcome to The Portal</h1>
        <p className="mt-2 text-sm text-muted">
          Let&rsquo;s start with your name, so we know who we&rsquo;re talking to.
        </p>
        <WelcomeForm />
      </div>
    </main>
  );
}
