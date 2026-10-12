import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Server-side Supabase client bound to the request's cookies (plan §11.2).
 *
 * Next 16 requires awaiting `cookies()`, so this factory is async. The client
 * acts as the signed-in user and is subject to RLS. Use it for auth checks
 * and RLS-backed reads; use the service-role client for privileged work.
 */
const fetchWithTimeout: typeof fetch = (input, init) => {
  const signal = init?.signal ?? AbortSignal.timeout(15_000);
  return fetch(input, { ...init, signal });
};

export async function createServerSupabase(): Promise<SupabaseClient> {
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase is not configured");
  }
  const cookieStore = await cookies();
  return createServerClient(
    e.NEXT_PUBLIC_SUPABASE_URL,
    e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      global: { fetch: fetchWithTimeout },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, {
                ...options,
                sameSite: "lax",
                secure: e.APP_ENV === "production" || e.APP_ENV === "staging",
              });
            }
          } catch {
            // Called from a Server Component where cookies can't be set.
            // Session refresh is handled by the proxy instead.
          }
        },
      },
    }
  );
}
