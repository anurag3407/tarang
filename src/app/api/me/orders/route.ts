import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { requireUser } from "@/services/authz";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { toPaise } from "@/lib/money";

export const dynamic = "force-dynamic";

/** GET /api/me/orders — the caller's orders (dashboard, plan §12.1). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser();
    await enforceRateLimit("me", `user:${ctx.userId}`, { failClosed: false });
    const sb = createServiceRoleClient();

    const { data, error } = await sb
      .from("orders")
      .select(
        `id, public_order_code, kind, checkout_state, amount_paise,
         currency, hold_expires_at, fulfilled_at, created_at,
         order_lines ( description_snapshot )`
      )
      .eq("purchaser_user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return apiError(req, "INTERNAL", "Could not load orders");

    const orders = (data ?? []).map((o) => {
      const line = Array.isArray(o.order_lines) ? o.order_lines[0] : o.order_lines;
      return {
        id: o.id,
        publicOrderCode: o.public_order_code,
        kind: o.kind,
        checkoutState: o.checkout_state,
        amountPaise: toPaise(o.amount_paise),
        currency: o.currency,
        holdExpiresAt: o.hold_expires_at,
        fulfilledAt: o.fulfilled_at,
        createdAt: o.created_at,
        description: line?.description_snapshot ?? "",
      };
    });
    return apiSuccess(req, { orders });
  } catch (err) {
    return apiFromError(req, err);
  }
}
