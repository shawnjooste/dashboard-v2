"use server";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { notifyPendingSignup } from "@/lib/notify";

export type ActionState = { error?: string; codeSent?: boolean; email?: string };

export async function requestCode(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { error: "Enter your email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    return {
      error: "We couldn't send a code right now. Please try again in a moment.",
      email,
    };
  }
  return { codeSent: true, email };
}

export async function verifyCode(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: "Enter the 6-digit code.", codeSent: true, email };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) {
    return {
      error: "That code is invalid or has expired. Request a new one.",
      codeSent: true,
      email,
    };
  }

  // Notify staff if this user is sitting in the pending-approval queue.
  // Best-effort: never let a notification failure block sign-in.
  if (data.user) {
    try {
      await notifyPendingSignup(data.user.id);
    } catch (e) {
      console.error("pending-signup notification failed:", e);
    }
  }

  redirect("/");
}
