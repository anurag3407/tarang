import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { readJsonBody, requireIdempotencyKey } from "@/lib/route-utils";
import { merchandiseCheckoutSchema } from "@/lib/validation/schemas";
import { requireUser, assertNotMaintenance } from "@/services/authz";
import { createMerchandiseCheckout } from "@/services/checkout-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/merchandise — secure checkout for merchandise products.
 *
 * Product price and capacity are snapshotted server-side from Postgres.
 */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const auth = await requireUser();
    await assertNotMaintenance(auth.festivalId);

    await enforceRateLimit("order", `user:${auth.userId}`, { failClosed: true });

    const idempotencyKey = requireIdempotencyKey(req);
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = merchandiseCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid merchandise checkout request", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }

    const result = await createMerchandiseCheckout(
      auth.userId,
      auth.festivalId,
      {
        productId: parsed.data.productId,
        selectedSize: parsed.data.selectedSize,
        quantity: parsed.data.quantity,
        recipientName: parsed.data.recipientName,
        recipientPhone: parsed.data.recipientPhone,
        recipientEmail: parsed.data.recipientEmail,
        deliveryMode: parsed.data.deliveryMode,
        shippingAddress: parsed.data.shippingAddress as Record<string, string> | null,
      },
      idempotencyKey
    );

    return apiSuccess(req, result, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
