import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readJsonBody, requireUuid } from "@/lib/route-utils";
import { discountCodeUpdateSchema } from "@/lib/validation/schemas";
import { DISCOUNT_CODE_COLUMNS, toDiscountCodeRead, type DiscountCodeRow } from "@/services/discount-admin";

export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

/**
 * PATCH /api/admin/discount-codes/:id — activate/deactivate or change limits
 * and validity, with an optimistic version check. The code and its value
 * cannot change; orders already placed keep the discount they were quoted.
 */
export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/admin/discount-codes/[id]">) {
  try {
    const id = requireUuid((await ctx.params).id, "Discount code");
    const auth = await guardAdminMutation(req, "discount.manage", { maxBodyBytes: 4 * 1024 });
    if (!idSchema.safeParse(id).success) return apiError(req, "NOT_FOUND", "Discount code not found");

    const body = await readJsonBody<Record<string, unknown>>(req, 4 * 1024);
    const parsed = discountCodeUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid discount code update", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const input = parsed.data;
    const sb = createServiceRoleClient();

    const { data: before } = await sb
      .from("discount_codes")
      .select(DISCOUNT_CODE_COLUMNS)
      .eq("id", id)
      .eq("festival_id", auth.festivalId)
      .maybeSingle();
    if (!before) return apiError(req, "NOT_FOUND", "Discount code not found");

    const patch: Record<string, unknown> = {
      version: input.version + 1,
      updated_at: new Date().toISOString(),
    };
    if (input.isActive !== undefined) patch.is_active = input.isActive;
    if (input.description !== undefined) patch.description = input.description;
    if (input.maxRedemptions !== undefined) patch.max_redemptions = input.maxRedemptions;
    if (input.perUserLimit !== undefined) patch.per_user_limit = input.perUserLimit;
    if (input.validFrom !== undefined) patch.valid_from = input.validFrom;
    if (input.validUntil !== undefined) patch.valid_until = input.validUntil;

    const { data: updated, error } = await sb
      .from("discount_codes")
      .update(patch)
      .eq("id", id)
      .eq("festival_id", auth.festivalId)
      .eq("version", input.version)
      .select(DISCOUNT_CODE_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23514") {
        return apiError(req, "VALIDATION_FAILED", "Valid-until must be after valid-from");
      }
      return apiError(req, "INTERNAL", "Could not update discount code");
    }
    if (!updated) {
      return apiError(req, "VERSION_CONFLICT", "Discount code changed by someone else — reload and retry");
    }

    const code = toDiscountCodeRead(updated as DiscountCodeRow);
    const userSb = await createServerSupabase();
    await userSb.rpc("write_audit", {
      p_action: "discount_code.update",
      p_target_type: "discount_code",
      p_target_id: id,
      p_before: toDiscountCodeRead(before as DiscountCodeRow),
      p_after: code,
    });

    return apiSuccess(req, { code });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/**
 * DELETE /api/admin/discount-codes/:id — only for codes no order has ever
 * referenced. Used codes are kept for the order history; deactivate them.
 */
export async function DELETE(req: NextRequest, ctx: RouteContext<"/api/admin/discount-codes/[id]">) {
  try {
    const id = requireUuid((await ctx.params).id, "Discount code");
    const auth = await guardAdminMutation(req, "discount.manage");
    if (!idSchema.safeParse(id).success) return apiError(req, "NOT_FOUND", "Discount code not found");

    const sb = createServiceRoleClient();
    const { data: deleted, error } = await sb
      .from("discount_codes")
      .delete()
      .eq("id", id)
      .eq("festival_id", auth.festivalId)
      .select(DISCOUNT_CODE_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23503") {
        return apiError(req, "CONFLICT", "This code has been used on orders — deactivate it instead");
      }
      return apiError(req, "INTERNAL", "Could not delete discount code");
    }
    if (!deleted) return apiError(req, "NOT_FOUND", "Discount code not found");

    const userSb = await createServerSupabase();
    await userSb.rpc("write_audit", {
      p_action: "discount_code.delete",
      p_target_type: "discount_code",
      p_target_id: id,
      p_before: toDiscountCodeRead(deleted as DiscountCodeRow),
    });

    return apiSuccess(req, { id });
  } catch (err) {
    return apiFromError(req, err);
  }
}
