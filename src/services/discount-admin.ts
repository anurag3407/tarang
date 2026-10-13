import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AppError } from "@/lib/errors";
import { toPaise } from "@/lib/money";

/**
 * Admin-side discount code reads (migration 20261013130000).
 *
 * discount_codes has no RLS policies, so every read goes through the service
 * role — callers must have passed guardAdminRead/guardAdminMutation with
 * `discount.manage` first.
 */

export const DISCOUNT_CODE_COLUMNS =
  "id, code, description, discount_type, amount_off_paise, percent_off, pass_product_id, max_redemptions, per_user_limit, valid_from, valid_until, is_active, version, created_at, updated_at";

export interface DiscountCodeRow {
  id: string;
  code: string;
  description: string;
  discount_type: "FLAT" | "PERCENT";
  amount_off_paise: string | number | null;
  percent_off: number | null;
  pass_product_id: string | null;
  max_redemptions: number | null;
  per_user_limit: number;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DiscountCodeUsage {
  fulfilledCount: number;
  pendingCount: number;
  fulfilledDiscountPaise: number;
}

const NO_USAGE: DiscountCodeUsage = { fulfilledCount: 0, pendingCount: 0, fulfilledDiscountPaise: 0 };

export function toDiscountCodeRead(row: DiscountCodeRow, usage: DiscountCodeUsage = NO_USAGE) {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    discountType: row.discount_type,
    amountOffPaise: row.amount_off_paise === null ? null : toPaise(row.amount_off_paise),
    percentOff: row.percent_off,
    passProductId: row.pass_product_id,
    maxRedemptions: row.max_redemptions,
    perUserLimit: row.per_user_limit,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    isActive: row.is_active,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usage,
  };
}

/** Per-code redemption counts for the festival, keyed by code id. */
export async function loadDiscountUsage(festivalId: string): Promise<Map<string, DiscountCodeUsage>> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb.rpc("discount_code_usage", { p_festival_id: festivalId });
  if (error) throw new AppError("INTERNAL", "Could not load discount usage");
  const usage = new Map<string, DiscountCodeUsage>();
  for (const row of (data ?? []) as Array<{
    discount_code_id: string;
    fulfilled_count: string | number;
    pending_count: string | number;
    fulfilled_discount_paise: string | number;
  }>) {
    usage.set(row.discount_code_id, {
      fulfilledCount: Number(row.fulfilled_count),
      pendingCount: Number(row.pending_count),
      fulfilledDiscountPaise: toPaise(row.fulfilled_discount_paise),
    });
  }
  return usage;
}
