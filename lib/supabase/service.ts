import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. BYPASSES RLS. Server/CLI only — never import into a
 * client component. Used by the ingestion CLI and admin-only server actions.
 */
export function createServiceClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
