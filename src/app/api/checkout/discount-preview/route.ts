import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp, hashIdentifier } from "@/lib/request-context";
import { readJsonBody } from "@/lib/route-utils";
import { discountPreviewSchema } from "@/lib/validation/schemas";
import { requireUser, assertNotMaintenance } from "@/services/authz";
import { previewPassDiscount } from "@/services/checkout-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/discount-preview — quote a pass price with a discount
 * code applied. Read-only: nothing is reserved until checkout.
 *
 * Signed-in users only (per-user limits need an identity) and rate limited
 * per user and per IP, failing closed, so codes cannot be guessed by brute
 * force. The price shown here is advisory; checkout recomputes it.
 */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req, { maxBodyBytes: 1024 });
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const ctx = await requireUser();
    await assertNotMaintenance(ctx.festivalId);

    await enforceRateLimit("discount", `user:${ctx.userId}`, { failClosed: true });
    const ip = getClientIp(req);
    if (ip) {
      await enforceRateLimit("discountIp", `ip:${hashIdentifier(ip)}`, { failClosed: true });
    }

    const body = await readJsonBody<Record<string, unknown>>(req, 1024);
    const parsed = discountPreviewSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "DISCOUNT_INVALID", "This discount code is invalid or has expired");
    }

    const quote = await previewPassDiscount(
      ctx.userId,
      ctx.festivalId,
      parsed.data.passProductId,
      parsed.data.code
    );
    return apiSuccess(req, quote);
  } catch (err) {
    return apiFromError(req, err);
  }
}
