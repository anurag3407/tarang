import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/route-utils";
import { eventCapacitySchema } from "@/lib/validation/schemas";
import { invalidateAvailability, invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/events/:id/capacity — safe conditional capacity change
 * (plan §11.6). Reductions below held+confirmed are rejected with
 * CAPACITY_BELOW_COMMITTED.
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/events/[id]/capacity">
) {
  try {
    const { id } = await ctx.params;
    const auth = await guardAdminMutation(req, "content.event.capacity.write", {
      eventId: id,
    });
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = eventCapacitySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid capacity change", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }

    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("admin_set_event_capacity", {
      p_event_id: id,
      p_new_capacity: parsed.data.capacityUnits,
      p_expected_version: parsed.data.version,
    });
    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(auth.festivalId, ["events"]);
    await invalidateAvailability(auth.festivalId, id);
    return apiSuccess(req, { inventory: data });
  } catch (err) {
    return apiFromError(req, err);
  }
}
