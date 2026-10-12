import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { readJsonBody, requireIdempotencyKey } from "@/lib/route-utils";
import { basePassCheckoutSchema } from "@/lib/validation/schemas";
import { requireUser, getFeatureFlag, assertNotMaintenance } from "@/services/authz";
import { createBasePassCheckout } from "@/services/checkout-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/base-pass (plan §12.3).
 *
 * Body carries only the pass product id — never amount/currency. The
 * Idempotency-Key header is generated once per user action and reused on
 * retries.
 */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const ctx = await requireUser();
    await assertNotMaintenance(ctx.festivalId);

    const salesEnabled = await getFeatureFlag(
      ctx.festivalId,
      "base_pass_sales_enabled",
      { failClosed: true }
    );
    if (!salesEnabled) {
      return apiError(req, "SALES_PAUSED", "Base pass sales are temporarily paused");
    }

    await enforceRateLimit("order", `user:${ctx.userId}`, { failClosed: true });

    const idempotencyKey = requireIdempotencyKey(req);
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = basePassCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid checkout request");
    }

    const result = await createBasePassCheckout(
      ctx.userId,
      ctx.festivalId,
      parsed.data.passProductId,
      idempotencyKey
    );
    return apiSuccess(req, result, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
