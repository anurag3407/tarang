import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminRead } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { toPaise } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/pass-products — pass products with price versioning history for admin management.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await guardAdminRead(req, "content.event.read");
    const sb = await createServerSupabase();

    const { data: products, error } = await sb
      .from("pass_products")
      .select(
        `id, slug, name, description, is_base_pass, sales_state, valid_from,
         valid_until, status, current_price_version_id, updated_at`
      )
      .eq("festival_id", auth.festivalId)
      .order("created_at", { ascending: true });
    if (error) return apiError(req, "INTERNAL", "Could not load pass products");

    const productIds = (products ?? []).map((p) => p.id);
    const { data: priceVersions } = await sb
      .from("pass_price_versions")
      .select("id, pass_product_id, version, unit_amount_paise, change_reason, created_at")
      .in("pass_product_id", productIds.length > 0 ? productIds : ["00000000-0000-0000-0000-000000000000"])
      .order("version", { ascending: false });

    const versionsByProduct = new Map<string, typeof priceVersions>();
    for (const pv of priceVersions ?? []) {
      const list = versionsByProduct.get(pv.pass_product_id) ?? [];
      list.push(pv);
      versionsByProduct.set(pv.pass_product_id, list);
    }

    const items = (products ?? []).map((p) => {
      const history = versionsByProduct.get(p.id) ?? [];
      const current = history.find((h) => h.id === p.current_price_version_id) ?? history[0];
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        description: p.description,
        isBasePass: p.is_base_pass,
        salesState: p.sales_state,
        status: p.status,
        currentPricePaise: current ? toPaise(current.unit_amount_paise) : 0,
        currentPriceVersion: current?.version ?? 1,
        priceHistory: history.map((h) => ({
          id: h.id,
          version: h.version,
          amountPaise: toPaise(h.unit_amount_paise),
          reason: h.change_reason,
          createdAt: h.created_at,
        })),
        updatedAt: p.updated_at,
      };
    });

    return apiSuccess(req, { products: items });
  } catch (err) {
    return apiFromError(req, err);
  }
}
