import type { NextRequest } from "next/server";
import { apiFromError, apiSuccess } from "@/lib/api";
import { loadPublicContent } from "@/lib/content-loader";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/schedule — day-grouped schedule (plan §11.10).
 * Degrades to the bundled static schedule when Supabase is unavailable.
 */
export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit("public", `schedule:${ip}`, { failClosed: false });

    const { schedule, festivalId, source } = await loadPublicContent();
    return apiSuccess(req, { festivalId, source, days: schedule });
  } catch (err) {
    return apiFromError(req, err);
  }
}
