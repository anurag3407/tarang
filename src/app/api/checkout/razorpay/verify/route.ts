import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { readJsonBody } from "@/lib/route-utils";
import { razorpayVerifySchema } from "@/lib/validation/schemas";
import { requireUser } from "@/services/authz";
import { verifyAndApplyBrowserCallback } from "@/services/payment-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/razorpay/verify (plan §12.7).
 *
 * The browser success callback is only a hint. We verify the HMAC, confirm
 * the order belongs to this user, fetch authoritative provider state, and
 * only then apply the captured payment idempotently.
 */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const ctx = await requireUser();
    await enforceRateLimit("order", `verify:${ctx.userId}`, { failClosed: true });

    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = razorpayVerifySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid verification payload");
    }

    const { result, orderId } = await verifyAndApplyBrowserCallback(
      ctx.userId,
      parsed.data.razorpayOrderId,
      parsed.data.razorpayPaymentId,
      parsed.data.razorpaySignature
    );
    return apiSuccess(req, { result, orderId });
  } catch (err) {
    return apiFromError(req, err);
  }
}
