import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireUser } from "@/services/authz";
import { toPaise } from "@/lib/money";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { requireUuid } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/checkout/orders/:orderId — poll local order state (plan §12.6.7).
 *
 * Owner-only. Returns checkout state so the UI can poll with backoff and
 * stop showing "processing" once fulfilled/expired. Never exposes other
 * users' orders.
 *
 * `paymentObserved` and `underReview` exist so the client never has to guess
 * from checkout_state alone whether money moved. Without them the UI cannot
 * tell an abandoned EXPIRED order (safe to retry) from one whose late capture
 * the reconciler is still chasing (retrying means paying twice), and it cannot
 * tell a user in PAYMENT_REVIEW that we already hold their money.
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/checkout/orders/[orderId]">
) {
  try {
    const orderId = requireUuid((await ctx.params).orderId, "Order");
    const auth = await requireUser();
    await enforceRateLimit("poll", `user:${auth.userId}`, { failClosed: false });

    const sb = createServiceRoleClient();
    const { data: order, error } = await sb
      .from("orders")
      .select(
        "id, public_order_code, purchaser_user_id, checkout_state, amount_paise, currency, hold_expires_at, fulfilled_at, created_at"
      )
      .eq("id", orderId)
      .maybeSingle();
    if (error || !order) {
      return apiError(req, "NOT_FOUND", "Order not found");
    }
    if (order.purchaser_user_id !== auth.userId) {
      return apiError(req, "FORBIDDEN", "This order does not belong to your account");
    }

    const { data: mapping } = await sb
      .from("razorpay_orders")
      .select("razorpay_order_id")
      .eq("local_order_id", orderId)
      .maybeSingle();

    let paymentState: string | null = null;
    let disposition: string | null = null;
    if (mapping?.razorpay_order_id) {
      const { data: payment } = await sb
        .from("payments")
        .select("provider_status, disposition")
        .eq("razorpay_order_id", mapping.razorpay_order_id)
        .order("last_observed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      paymentState = payment?.provider_status ?? null;
      disposition = payment?.disposition ?? null;
    }

    // A payment row exists at all: the provider saw this attempt, so a second
    // attempt risks a second debit. Deliberately not narrowed to "captured" —
    // an authorized-but-not-yet-captured payment is exactly the case where the
    // user must not be told to pay again.
    const paymentObserved = paymentState !== null;

    // Money we hold that no automated path can turn into an entitlement.
    const underReview =
      order.checkout_state === "PAYMENT_REVIEW" ||
      disposition === "REFUND_REQUIRED" ||
      disposition === "REVIEW";

    return apiSuccess(req, {
      localOrderId: order.id,
      publicOrderCode: order.public_order_code,
      status: order.checkout_state,
      amountPaise: toPaise(order.amount_paise),
      currency: order.currency,
      holdExpiresAt: order.hold_expires_at,
      fulfilledAt: order.fulfilled_at,
      createdAt: order.created_at,
      paymentState,
      paymentObserved,
      underReview,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
