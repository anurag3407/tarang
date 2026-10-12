import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { requireUser } from "@/services/authz";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

/** GET /api/me/passes — the caller's delegate passes (dashboard). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser();
    await enforceRateLimit("me", `user:${ctx.userId}`, { failClosed: false });
    const sb = createServiceRoleClient();

    const { data, error } = await sb
      .from("delegate_passes")
      .select(
        `id, public_pass_code, state, activated_at, expires_at,
         pass_products ( id, name, slug, is_base_pass )`
      )
      .eq("user_id", ctx.userId)
      .eq("festival_id", ctx.festivalId)
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) return apiError(req, "INTERNAL", "Could not load passes");

    const passes = (data ?? []).map((p) => {
      const product = Array.isArray(p.pass_products)
        ? p.pass_products[0]
        : p.pass_products;
      return {
        id: p.id,
        publicPassCode: p.public_pass_code,
        state: p.state,
        activatedAt: p.activated_at,
        expiresAt: p.expires_at,
        productName: product?.name ?? "Delegate Pass",
        productSlug: product?.slug ?? "base-delegate-pass",
        isBasePass: product?.is_base_pass ?? false,
      };
    });
    return apiSuccess(req, { passes });
  } catch (err) {
    return apiFromError(req, err);
  }
}
