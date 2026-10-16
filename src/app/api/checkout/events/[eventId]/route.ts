import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { readJsonBody, requireIdempotencyKey, requireUuid } from "@/lib/route-utils";
import { eventCheckoutSchema } from "@/lib/validation/schemas";
import { requireUser, getFeatureFlag, assertNotMaintenance } from "@/services/authz";
import { createEventCheckout } from "@/services/checkout-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/checkout/events/:eventId (plan §12.5).
 *
 * No price, capacity, fee, quantity, or participant array comes from the
 * browser — only the registration mode and (for teams) the draft id.
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/checkout/events/[eventId]">
) {
  try {
    const eventId = requireUuid((await ctx.params).eventId, "Event");
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const auth = await requireUser();
    await assertNotMaintenance(auth.festivalId);

    const salesEnabled = await getFeatureFlag(
      auth.festivalId,
      "event_sales_enabled",
      { failClosed: true }
    );
    if (!salesEnabled) {
      return apiError(req, "SALES_PAUSED", "Event sales are temporarily paused");
    }

    await enforceRateLimit("order", `user:${auth.userId}`, { failClosed: true });

    const idempotencyKey = requireIdempotencyKey(req);
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = eventCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid checkout request", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }

    const result = await createEventCheckout(
      auth.userId,
      auth.festivalId,
      eventId,
      parsed.data.registrationMode,
      parsed.data.teamDraftId ?? null,
      idempotencyKey
    );
    return apiSuccess(req, result, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
