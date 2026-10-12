import type { NextRequest } from "next/server";
import { apiFromError, apiSuccess } from "@/lib/api";
import { loadPublicContent } from "@/lib/content-loader";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp } from "@/lib/request-context";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/notices — published notices (plan §11.10).
 * Degrades to the bundled static notices when Supabase is unavailable.
 */
export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit("public", `notices:${ip}`, { failClosed: false });

    const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 50)
      : 50;

    const { notices, festivalId, source } = await loadPublicContent();
    return apiSuccess(req, { festivalId, source, notices: notices.slice(0, limit) });
  } catch (err) {
    return apiFromError(req, err);
  }
}
