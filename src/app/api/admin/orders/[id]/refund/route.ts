import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    const adminCtx = await guardAdminMutation(req, "admin.access");
    const { id: orderId } = await ctx.params;

    const sb = createServiceRoleClient();

    // 1. Verify order exists
    const { data: order, error: orderErr } = await sb
      .from("orders")
      .select("id, public_order_code, purchaser_user_id, checkout_state, amount_paise")
      .eq("id", orderId)
      .maybeSingle();

    if (orderErr) {
      return apiError(req, "INTERNAL", orderErr.message);
    }
    if (!order) {
      return apiError(req, "NOT_FOUND", "Order not found");
    }

    // 2. Execute refund via database RPC if available, with resilient fallback
    const { data: rpcData, error: rpcErr } = await sb.rpc("refund_order", {
      p_order_id: orderId,
      p_actor_user_id: adminCtx.userId,
      p_reason: "Manual refund processed by organizers via Admin Mission Control",
    });

    if (rpcErr) {
      logger().warn(
        { err: rpcErr.message, orderId },
        "refund_order RPC failed or not yet applied; falling back to direct service-role mutation"
      );

      // Resilient direct fallback
      const nowIso = new Date().toISOString();

      // Update Order
      await sb
        .from("orders")
        .update({
          checkout_state: "REFUNDED",
          updated_at: nowIso,
        })
        .eq("id", orderId);

      // Find Order Lines
      const { data: lines } = await sb
        .from("order_lines")
        .select("id")
        .eq("order_id", orderId);

      const lineIds = (lines ?? []).map((l) => l.id);

      if (lineIds.length > 0) {
        // Find Delegate Passes
        const { data: passes } = await sb
          .from("delegate_passes")
          .select("id")
          .in("source_order_line_id", lineIds);

        const passIds = (passes ?? []).map((p) => p.id);

        // Update Passes
        await sb
          .from("delegate_passes")
          .update({
            state: "REFUNDED",
            revoked_at: nowIso,
            updated_at: nowIso,
          })
          .in("source_order_line_id", lineIds);

        // Revoke QR Credentials
        if (passIds.length > 0) {
          await sb
            .from("qr_credentials")
            .update({
              state: "REVOKED",
              revoked_at: nowIso,
            })
            .in("delegate_pass_id", passIds);
        }

        // Update Registrations
        await sb
          .from("registrations")
          .update({
            state: "REFUNDED",
            cancelled_at: nowIso,
            updated_at: nowIso,
          })
          .in("order_line_id", lineIds);
      }

      // Update Merchandise Orders
      await sb
        .from("merchandise_orders")
        .update({
          state: "REFUNDED",
          updated_at: nowIso,
        })
        .eq("order_id", orderId);

      // Update Payments
      await sb
        .from("payments")
        .update({
          disposition: "REFUNDED",
          refunded_paise: Number(order.amount_paise || 0),
          updated_at: nowIso,
        })
        .eq("local_order_id", orderId);
    }

    // 3. Clear existing sheets sync row so that spreadsheet sync records the REFUNDED status
    await sb.from("sheets_sync_items").delete().eq("entity_id", orderId);

    logger().info(
      { orderId, publicOrderCode: order.public_order_code, adminUserId: adminCtx.userId },
      "order successfully marked as REFUNDED"
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
