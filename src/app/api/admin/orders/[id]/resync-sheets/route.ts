import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { syncOrderToSpreadsheets } from "@/services/sheets-service";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { requireUuid } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  try {
    await guardAdminMutation(req, "registration.export");
    const orderId = requireUuid((await ctx.params).id, "Order");

    const sb = createServiceRoleClient();
    // Allow re-sync by deleting old sync record so lock can be reacquired
    await sb.from("sheets_sync_items").delete().eq("entity_id", orderId);

    const result = await syncOrderToSpreadsheets(orderId);
    if (!result.synced) {
      return apiError(req, "INTERNAL", result.error ?? "Sheets sync failed");
    }

    return apiSuccess(req, {
      message: "Order successfully synced to Google Sheets",
      orderId,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
