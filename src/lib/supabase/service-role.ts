import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

let client: SupabaseClient | null = null;

/**
 * Service-role Supabase client (plan §2.2.4, §6.3).
 *
 * Bypasses RLS. MUST only be imported from server-only modules (Route
 * Handlers, services, repositories, workers). Never exposed to the browser.
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const signal = init?.signal ?? AbortSignal.timeout(15_000);
  return fetch(input, { ...init, signal });
};

export function createServiceRoleClient(): SupabaseClient {
  if (client) return client;
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase service role is not configured");
  }
  client = createClient(
    e.NEXT_PUBLIC_SUPABASE_URL,
    e.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithTimeout },
    }
  );
  return client;
}
