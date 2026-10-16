import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess, AppError } from "@/lib/api";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireUser } from "@/services/authz";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { validateMutationRequest } from "@/lib/csrf";
import { requireUuid } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/orders/:orderId/cancel
 *
 * User explicitly cancels an in-progress/awaiting checkout.
 * Releases any capacity holds and marks order as CANCELLED.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ orderId: string }> }
) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const orderId = requireUuid((await ctx.params).orderId, "Order");
    const auth = await requireUser();
    await enforceRateLimit("order", `cancel:${auth.userId}`, {
      failClosed: true,
    });

    const sb = createServiceRoleClient();
    const { data, error } = await sb.rpc("cancel_order", {
      p_order_id: orderId,
      p_user_id: auth.userId,
    });

    if (error) {
      const msg = error.message ?? "";
      if (msg.includes("NOT_FOUND"))
        return apiError(req, "NOT_FOUND", "Order not found");
      if (msg.includes("FORBIDDEN"))
        return apiError(req, "FORBIDDEN", "This order does not belong to your account");
      if (msg.includes("CANNOT_CANCEL"))
        return apiError(
          req,
          "BAD_REQUEST",
          "This order can no longer be cancelled"
        );
      throw new AppError("INTERNAL", "Order cancellation failed");
    }

    return apiSuccess(req, data);
  } catch (err) {
    return apiFromError(req, err);
  }
}
