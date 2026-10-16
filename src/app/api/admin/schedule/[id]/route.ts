import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { readJsonBody, requireUuid } from "@/lib/route-utils";
import { scheduleAdminSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/schedule/:id — update with optimistic version
 * (plan §11.7). Conflict detection for venue/time overlaps happens in SQL.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/schedule/[id]">
) {
  try {
    const id = requireUuid((await ctx.params).id, "Schedule entry");
    const auth = await guardAdminMutation(req, "content.schedule.write");
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = scheduleAdminSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid schedule entry", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const input = parsed.data;

    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("admin_upsert_schedule_entry", {
      p_entry_id: id,
      p_festival_id: auth.festivalId,
      p_linked_event_id: input.linkedEventId,
      p_title: input.title,
      p_venue_id: input.venueId,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_category_key: input.categoryKey,
      p_is_night: input.isNight,
      p_day_theme: input.dayTheme,
      p_expected_version: input.version,
    });
    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(auth.festivalId, ["schedule"]);
    return apiSuccess(req, { entry: data });
  } catch (err) {
    return apiFromError(req, err);
  }
}
