import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rupeesToPaise } from "@/lib/money";
import { readJsonBody, requireUuid } from "@/lib/route-utils";
import { passPriceSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/pass-products/:id/price — Dynamic pricing update for Delegate Pass / Pass Products.
 * Creates an immutable new price version with change reason.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = requireUuid((await params).id, "Pass product");
    const auth = await guardAdminMutation(req, "content.event.price.write");
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = passPriceSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid price change request", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const { priceRupees, reason } = parsed.data;
    const amountPaise = rupeesToPaise(priceRupees);

    const sb = createServiceRoleClient();

    // Verify the pass product exists
    const { data: product, error: fetchErr } = await sb
      .from("pass_products")
      .select("id, name, festival_id, current_price_version_id")
      .eq("id", id)
      .eq("festival_id", auth.festivalId)
      .maybeSingle();
    if (fetchErr || !product) {
      return apiError(req, "NOT_FOUND", "Pass product not found");
    }

    // Get the latest price version number
    const { data: latestVersion } = await sb
      .from("pass_price_versions")
      .select("version")
      .eq("pass_product_id", id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (latestVersion?.version ?? 0) + 1;

    // Insert new immutable price version
    const { data: newPriceVersion, error: insertErr } = await sb
      .from("pass_price_versions")
      .insert({
        pass_product_id: id,
        version: nextVersion,
        unit_amount_paise: amountPaise,
        currency: "INR",
        created_by: auth.userId,
        change_reason: reason,
      })
      .select("id, version, unit_amount_paise, change_reason, created_at")
      .single();
    if (insertErr || !newPriceVersion) {
      return apiError(req, "INTERNAL", "Could not create new price version");
    }

    // Point pass product to the new version
    const { error: updateErr } = await sb
      .from("pass_products")
      .update({
        current_price_version_id: newPriceVersion.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updateErr) {
      return apiError(req, "INTERNAL", "Could not update pass product current price version");
    }

    await invalidateContentCache(auth.festivalId, ["events"]);

    return apiSuccess(req, {
      product: {
        id: product.id,
        name: product.name,
        currentPricePaise: amountPaise,
        currentPriceVersion: newPriceVersion.version,
        priceVersion: newPriceVersion,
      },
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
