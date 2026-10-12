import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { loadPublicContent } from "@/lib/content-loader";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/events/:slug — single published event (plan §11.11).
 * Degrades to the bundled static catalog when Supabase is unavailable.
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/public/events/[slug]">
) {
  try {
    const { slug } = await ctx.params;
    const ip = getClientIp(req);
    await enforceRateLimit("public", `event:${ip}`, { failClosed: false });

    const { events, festivalId, source } = await loadPublicContent();
    const event = events.find((e) => e.slug === slug);
    if (!event) {
      return apiError(req, "NOT_FOUND", "Event not found");
    }
    return apiSuccess(req, { festivalId, source, event });
  } catch (err) {
    return apiFromError(req, err);
  }
}
