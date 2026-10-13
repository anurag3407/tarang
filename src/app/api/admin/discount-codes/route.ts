import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rupeesToPaise } from "@/lib/money";
import { readJsonBody } from "@/lib/route-utils";
import { discountCodeCreateSchema } from "@/lib/validation/schemas";
import {
  DISCOUNT_CODE_COLUMNS,
  loadDiscountUsage,
  toDiscountCodeRead,
  type DiscountCodeRow,
} from "@/services/discount-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/discount-codes — every code for the festival with usage,
 * plus the pass products a code can be scoped to. Superadmin only
 * (`discount.manage` is a protected permission).
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await guardAdminRead(req, "discount.manage");
    const sb = createServiceRoleClient();

    const [{ data: codes, error }, { data: products, error: productsError }, usage] = await Promise.all([
      sb
        .from("discount_codes")
        .select(DISCOUNT_CODE_COLUMNS)
        .eq("festival_id", auth.festivalId)
        .order("created_at", { ascending: false }),
      sb
        .from("pass_products")
        .select("id, name, status, sales_state")
        .eq("festival_id", auth.festivalId)
        .order("created_at", { ascending: true }),
      loadDiscountUsage(auth.festivalId),
    ]);
    if (error || productsError) return apiError(req, "INTERNAL", "Could not load discount codes");

    return apiSuccess(req, {
      codes: ((codes ?? []) as DiscountCodeRow[]).map((c) => toDiscountCodeRead(c, usage.get(c.id))),
      passProducts: (products ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        onSale: p.status === "PUBLISHED" && (p.sales_state === "OPEN" || p.sales_state === "SCHEDULED"),
      })),
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/** POST /api/admin/discount-codes — issue a new code. */
export async function POST(req: NextRequest) {
  try {
    const auth = await guardAdminMutation(req, "discount.manage", { maxBodyBytes: 4 * 1024 });
    const body = await readJsonBody<Record<string, unknown>>(req, 4 * 1024);
    const parsed = discountCodeCreateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid discount code", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const input = parsed.data;
    const sb = createServiceRoleClient();

    if (input.passProductId) {
      const { data: product } = await sb
        .from("pass_products")
        .select("id")
        .eq("id", input.passProductId)
        .eq("festival_id", auth.festivalId)
        .maybeSingle();
      if (!product) return apiError(req, "NOT_FOUND", "Pass product not found");
    }

    const { data: created, error } = await sb
      .from("discount_codes")
      .insert({
        festival_id: auth.festivalId,
        code: input.code,
        description: input.description,
        discount_type: input.discountType,
        amount_off_paise: input.amountOffRupees === null ? null : rupeesToPaise(input.amountOffRupees),
        percent_off: input.percentOff,
        pass_product_id: input.passProductId,
        max_redemptions: input.maxRedemptions,
        per_user_limit: input.perUserLimit,
        valid_from: input.validFrom,
        valid_until: input.validUntil,
        created_by: auth.userId,
      })
      .select(DISCOUNT_CODE_COLUMNS)
      .single();
    if (error || !created) {
      if (error?.code === "23505") {
        return apiError(req, "CONFLICT", `Discount code ${input.code} already exists`);
      }
      if (error?.code === "23514") {
        return apiError(req, "VALIDATION_FAILED", "Discount code settings are inconsistent");
      }
      return apiError(req, "INTERNAL", "Could not create discount code");
    }

    const code = toDiscountCodeRead(created as DiscountCodeRow);
    const userSb = await createServerSupabase();
    await userSb.rpc("write_audit", {
      p_action: "discount_code.create",
      p_target_type: "discount_code",
      p_target_id: code.id,
      p_after: code,
    });

    return apiSuccess(req, { code }, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
