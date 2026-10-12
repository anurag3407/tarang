import type { NextRequest } from "next/server";
import { apiFromError, apiSuccess } from "@/lib/api";
import { getCurrentFestivalId } from "@/repositories/public-content";
import { getPublishedMerchandise } from "@/repositories/merchandise";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/merchandise — public merchandise drop catalog.
 */
export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit("public", `merchandise:${ip}`, { failClosed: false });

    const festivalId = await getCurrentFestivalId();
    if (!festivalId) {
      return apiSuccess(req, { merchandise: [] });
    }

    const items = await getPublishedMerchandise(festivalId);
    const category = req.nextUrl.searchParams.get("category");
    const featuredOnly = req.nextUrl.searchParams.get("featured") === "true";

    let list = items;
    if (featuredOnly) {
      list = list.filter((i) => i.featured);
    }
    if (category && category !== "all") {
      list = list.filter((i) => i.category.toLowerCase() === category.toLowerCase());
    }

    return apiSuccess(req, { festivalId, merchandise: list });
  } catch (err) {
    return apiFromError(req, err);
  }
}
