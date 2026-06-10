import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database";

// While staff impersonate a user ("Sign in as"), the session IS the target's —
// block every mutation except the exit route so staff can look but never act
// as them. All app writes are POST server actions, so this is a global guard.
const IMPERSONATION_MARKER = "imp";

export async function updateSession(request: NextRequest) {
  if (
    request.cookies.get(IMPERSONATION_MARKER) &&
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.nextUrl.pathname !== "/impersonation/exit"
  ) {
    return NextResponse.json(
      { error: "read-only while impersonating" },
      { status: 403 },
    );
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}
