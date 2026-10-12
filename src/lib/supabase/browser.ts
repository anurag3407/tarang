"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env-public";

let client: SupabaseClient | null = null;

/**
 * Browser Supabase client (plan §2.2.2). Used only for Auth session helpers
 * and RLS-backed reads from client components. Never for financial/admin
 * tables — those go through same-origin Route Handlers.
 */
export function createClient(): SupabaseClient {
  if (client) return client;
  const e = env();
  if (!e.NEXT_PUBLIC_SUPABASE_URL || !e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase is not configured");
  }
  client = createBrowserClient(
    e.NEXT_PUBLIC_SUPABASE_URL,
    e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
  return client;
}
