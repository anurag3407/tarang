import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { invalidateContentCache } from "@/lib/invalidation";
import { requireUuid } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/events/:id/publish — validate and publish (plan §11.6).
 * Publishing fails when required fields/inventory/price are missing.
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/events/[id]/publish">
) {
  try {
    const id = requireUuid((await ctx.params).id, "Event");
    const auth = await guardAdminMutation(req, "content.event.publish", {
      eventId: id,
    });

    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("admin_publish_event", {
      p_event_id: id,
    });
    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(auth.festivalId, ["events", "schedule"]);
    return apiSuccess(req, { event: data });
  } catch (err) {
    return apiFromError(req, err);
  }
}
