import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { invalidateAvailability, invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/admin/events/:id/unpublish — revert event to draft status (plan §11.6).
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext
) {
  try {
    const { id } = await ctx.params;
    const auth = await guardAdminMutation(req, "content.event.publish", {
      eventId: id,
    });

    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("admin_unpublish_event", {
      p_event_id: id,
    });
    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(auth.festivalId, ["events", "schedule"]);
    await invalidateAvailability(auth.festivalId, id);
    return apiSuccess(req, { event: data });
  } catch (err) {
    return apiFromError(req, err);
  }
}
