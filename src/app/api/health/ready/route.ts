import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/env";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

let lastCheck = { at: 0, ok: false };
const CHECK_TTL_MS = 5000;

/**
 * GET /api/health/ready — readiness (plan §15.8).
 *
 * Uses a short cached dependency check so a probe storm doesn't hammer the
 * DB. Returns 503 when the app cannot serve traffic meaningfully.
 */
export async function GET() {
  const now = Date.now();

  if (now - lastCheck.at > CHECK_TTL_MS) {
    let ok = true;
    if (supabaseConfigured()) {
      try {
        const sb = createServiceRoleClient();
        const { error } = await sb.from("festivals").select("id").limit(1);
        ok = !error;
      } catch {
        ok = false;
      }
    }
    lastCheck = { at: now, ok };
  }

  const ready = lastCheck.ok;
  return NextResponse.json(
    { status: ready ? "ready" : "not_ready" },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } }
  );
}
