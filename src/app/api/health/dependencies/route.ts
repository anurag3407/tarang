import { NextResponse } from "next/server";
import {
  env,
  supabaseConfigured,
  redisConfigured,
  razorpayConfigured,
  resendConfigured,
} from "@/lib/env";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getRedis } from "@/lib/redis/client";
import { requirePermission } from "@/services/authz";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/dependencies — restricted detailed status (plan §15.8).
 *
 * Requires admin.access so provider configuration state is not public.
 * Reports configured/present + a cheap live probe per dependency. Never
 * echoes secrets.
 */
export async function GET() {
  try {
    await requirePermission("admin.access");
  } catch {
    return NextResponse.json({ ok: false }, { status: 403 });
  }

  const e = env();
  const deps: Record<string, { configured: boolean; live: boolean | null }> = {
    supabase: { configured: supabaseConfigured(), live: null },
    redis: { configured: redisConfigured(), live: null },
    razorpay: { configured: razorpayConfigured(), live: null },
    resend: { configured: resendConfigured(), live: null },
    qstash: { configured: Boolean(e.QSTASH_TOKEN), live: null },
  };

  if (deps.supabase.configured) {
    try {
      const sb = createServiceRoleClient();
      const { error } = await sb.from("festivals").select("id").limit(1);
      deps.supabase.live = !error;
    } catch {
      deps.supabase.live = false;
    }
  }
  if (deps.redis.configured) {
    try {
      const redis = getRedis();
      deps.redis.live = redis ? (await redis.ping()) === "PONG" : false;
    } catch {
      deps.redis.live = false;
    }
  }
  // Razorpay/Resend: configured-only (no free live probe without side effects).

  return NextResponse.json(
    {
      appEnv: e.APP_ENV,
      deploymentId: e.DEPLOYMENT_ID ?? null,
      dependencies: deps,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
