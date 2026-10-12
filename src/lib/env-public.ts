import { z } from "zod";

/**
 * Public environment variables only (safe for browser bundles).
 * Server-only variables live in `src/lib/env.ts`.
 */

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  NEXT_PUBLIC_RAZORPAY_KEY_ID: z.string().optional(),
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
});

export type PublicEnv = z.infer<typeof schema>;

let cached: PublicEnv | null = null;

function normalize(val: string | undefined): string | undefined {
  return val === "" ? undefined : val;
}

export function env(): PublicEnv {
  if (cached) return cached;
  cached = schema.parse({
    NEXT_PUBLIC_SUPABASE_URL: normalize(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: normalize(
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ),
    NEXT_PUBLIC_RAZORPAY_KEY_ID: normalize(
      process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
    ),
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: normalize(
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    ),
  });
  return cached;
}
