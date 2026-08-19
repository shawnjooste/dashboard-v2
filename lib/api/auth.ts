// Key auth for the scoped quote API: a Bearer API key becomes a gated Actor,
// or a uniform refusal. Every route in lib/api/ rests its safety story on
// this module — a missing key, a revoked key, and a malformed header must
// all fail exactly alike (see the design spec's decision on the 401 shape:
// docs/superpowers/specs/2026-08-13-quote-api-design.md).
import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/lib/quotes/policy";

export type AuthResult = { ok: true; actor: Actor; keyId: string } | { ok: false };

// /i on the whole pattern, not just the scheme word: the RFC 6750 "Bearer"
// keyword is case-insensitive, and since the token's actual entropy lives in
// the \S+ suffix (hashed case-sensitively by hashApiKey below), tolerating
// odd casing on the literal "rq_live_" prefix costs nothing — a wrong-case
// key still fails auth on the hash comparison, same as any other typo.
const BEARER_KEY_RE = /^Bearer\s+(rq_live_\S+)$/i;

/** Pure so it can be tested for determinism and reused by the minting CLI
 *  (scripts/api-key.mjs) for byte-identical hashing — hex sha256 of the full
 *  raw key, prefix included. */
export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function extractRawKey(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = BEARER_KEY_RE.exec(authorizationHeader);
  return match ? match[1] : null;
}

export async function authenticateApiKey(
  sb: SupabaseClient,
  authorizationHeader: string | null,
): Promise<AuthResult> {
  const raw = extractRawKey(authorizationHeader);
  if (!raw) return { ok: false };

  const keyHash = hashApiKey(raw);
  const { data, error } = await sb
    .from("api_keys")
    .select("id, name, profile_id, revoked_at")
    .eq("key_hash", keyHash)
    .maybeSingle();

  // Unknown key and revoked key must be indistinguishable to the caller —
  // the API never reveals that a key exists but is revoked.
  if (error || !data || data.revoked_at) return { ok: false };

  // Fire-and-forget: a failed last_used_at stamp must never fail auth, and
  // an unhandled rejection in a Next route is a crash. Promise.resolve()
  // adopts the Postgrest builder's thenable so .catch() is always available,
  // whether the update lands as a real query or a synchronous stub.
  try {
    void Promise.resolve(
      sb.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id),
    ).catch((e) => console.error("authenticateApiKey: last_used_at update failed", e));
  } catch (e) {
    console.error("authenticateApiKey: last_used_at update failed", e);
  }

  return {
    ok: true,
    actor: {
      id: data.profile_id,
      label: data.name,
      // Hardcoded by design, not a column or a scope — every key has the
      // same single capability level. See the spec, decision 5.
      canSend: false,
    },
    keyId: data.id,
  };
}
