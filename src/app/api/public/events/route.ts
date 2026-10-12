import type { NextRequest } from "next/server";
import { apiFromError, apiSuccess } from "@/lib/api";
import { loadPublicContent } from "@/lib/content-loader";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/events — published events with availability (plan §11.10).
 * Degrades to the bundled static catalog when Supabase is unavailable
 * (plan §16: keep public static content on outage).
 */
export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit("public", `events:${ip}`, { failClosed: false });

    const { events, festivalId, source } = await loadPublicContent();
    const featuredOnly = req.nextUrl.searchParams.get("featured") === "true";
    const list = featuredOnly ? events.filter((e) => e.featured) : events;
    return apiSuccess(req, { festivalId, source, events: list });
  } catch (err) {
    return apiFromError(req, err);
  }
}
