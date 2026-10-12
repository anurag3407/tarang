import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { getCurrentFestivalId } from "@/repositories/public-content";
import { getPublishedMerchandiseBySlug } from "@/repositories/merchandise";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/merchandise/:slug — single merchandise product with full gallery.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const ip = getClientIp(req);
    await enforceRateLimit("public", `merchandise:${ip}`, { failClosed: false });

    const festivalId = await getCurrentFestivalId();
    if (!festivalId) {
      return apiError(req, "NOT_FOUND", "Merchandise product not found");
    }

    const item = await getPublishedMerchandiseBySlug(festivalId, slug);
    if (!item) {
      return apiError(req, "NOT_FOUND", "Merchandise product not found");
    }

    return apiSuccess(req, { merchandise: item });
  } catch (err) {
    return apiFromError(req, err);
  }
}
