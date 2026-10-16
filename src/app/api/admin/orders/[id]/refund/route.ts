import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { requireUuid } from "@/lib/route-utils";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/orders/:id/refund — record a manual organizer refund.
 *
 * The money is returned outside the app (Razorpay dashboard); this marks the
 * order, its passes/registrations and payments REFUNDED in one locked
 * transaction (refund_order). There is deliberately no fallback: if the
 * function rejects the refund, the order is left untouched.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const adminCtx = await guardAdminMutation(req, "refund.approve");
    const orderId = requireUuid((await ctx.params).id, "Order");

    const sb = createServiceRoleClient();

    const { data: order, error: orderErr } = await sb
      .from("orders")
      .select("id, public_order_code, festival_id")
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr) {
      logger().error({ err: orderErr.message, orderId }, "refund order lookup failed");
      return apiError(req, "INTERNAL", "Could not load the order");
    }
    // Festival-scoped RBAC: an admin of one festival cannot touch another's orders.
    if (!order || order.festival_id !== adminCtx.festivalId) {
      return apiError(req, "NOT_FOUND", "Order not found");
    }

    const { data: rpcData, error: rpcErr } = await sb.rpc("refund_order", {
      p_order_id: orderId,
      p_actor_user_id: adminCtx.userId,
      p_reason: "Manual refund processed by organizers via Admin Mission Control",
    });

    if (rpcErr) {
      const msg = rpcErr.message ?? "";
      if (msg.includes("NOT_FOUND")) return apiError(req, "NOT_FOUND", "Order not found");
      if (msg.includes("NOT_REFUNDABLE")) {
        return apiError(
          req,
          "CONFLICT",
          "This order has no captured payment to refund — cancel it instead"
        );
      }
      logger().error({ err: msg, orderId }, "refund_order failed");
      return apiError(req, "INTERNAL", "Refund could not be recorded");
    }

    // Clear the sheets sync row so the spreadsheet picks up the REFUNDED state.
    const { error: syncErr } = await sb
      .from("sheets_sync_items")
      .delete()
      .eq("entity_id", orderId);
    if (syncErr) {
      logger().warn({ err: syncErr.message, orderId }, "refund: sheets sync reset failed");
    }

    logger().info(
      { orderId, publicOrderCode: order.public_order_code, adminUserId: adminCtx.userId },
      "order marked as REFUNDED"
    );

    return apiSuccess(req, {
      refunded: true,
      orderId,
      publicOrderCode: order.public_order_code,
      message: `Order ${order.public_order_code} and all associated passes have been marked as REFUNDED.`,
      data: rpcData,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
