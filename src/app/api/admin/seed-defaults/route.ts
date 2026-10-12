import type { NextRequest } from "next/server";
import { apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { ensureDefaultCategoriesAndVenues } from "@/services/content-seeder";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/seed-defaults — Idempotently seed standard categories and venues
 * into the database for the active festival.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await guardAdminMutation(req, "content.event.write");
    const result = await ensureDefaultCategoriesAndVenues(ctx.festivalId);
    await invalidateContentCache(ctx.festivalId, ["events", "schedule"]);
    return apiSuccess(req, {
      message: "Standard categories and venues seeded successfully",
      categoriesCount: result.categories.length,
      venuesCount: result.venues.length,
      categories: result.categories,
      venues: result.venues,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
