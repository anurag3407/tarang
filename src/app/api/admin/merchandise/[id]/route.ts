import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { rupeesToPaise } from "@/lib/money";
import { readJsonBody } from "@/lib/route-utils";
import { merchandiseAdminSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

type MerchCtx = RouteContext<"/api/admin/merchandise/[id]">;

/**
 * GET /api/admin/merchandise/:id — load full editable merchandise product record.
 */
export async function GET(req: NextRequest, ctx: MerchCtx) {
  try {
    const { id } = await ctx.params;
    const admin = await guardAdminRead(req, "content.merchandise.read");
    const sb = await createServerSupabase();

    const { data, error } = await sb
      .from("merchandise_products")
      .select(
        `id, slug, name, tagline, description, details_markdown, category, price_paise,
         images, sizes, stock_units, held_units, confirmed_units, sales_state,
         status, featured, sort_order, version, created_at, updated_at`
      )
      .eq("id", id)
      .eq("festival_id", admin.festivalId)
      .maybeSingle();

    if (error) return apiError(req, "INTERNAL", "Could not load merchandise product");
    if (!data) return apiError(req, "NOT_FOUND", "Merchandise product not found");

    return apiSuccess(req, {
      merchandise: {
        id: data.id,
        slug: data.slug,
        name: data.name,
        tagline: data.tagline,
        description: data.description,
        detailsMarkdown: data.details_markdown,
        category: data.category,
        pricePaise: Number(data.price_paise),
        images: Array.isArray(data.images) ? data.images : [],
        sizes: Array.isArray(data.sizes) ? data.sizes : [],
        stockUnits: Number(data.stock_units),
        heldUnits: Number(data.held_units),
        confirmedUnits: Number(data.confirmed_units),
        availableUnits: Math.max(0, Number(data.stock_units) - Number(data.held_units) - Number(data.confirmed_units)),
        salesState: data.sales_state,
        status: data.status,
        featured: data.featured,
        sortOrder: data.sort_order,
        version: data.version,
        createdAt: data.created_at,
      },
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/**
 * PATCH /api/admin/merchandise/:id — update merchandise product with optimistic concurrency.
 */
export async function PATCH(req: NextRequest, ctx: MerchCtx) {
  try {
    const { id } = await ctx.params;
    const admin = await guardAdminMutation(req, "content.merchandise.write");
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = merchandiseAdminSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid merchandise payload", {
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const input = parsed.data;
    const pricePaise = rupeesToPaise(input.priceRupees);
    const sb = await createServerSupabase();

    const { data, error } = await sb.rpc("admin_upsert_merchandise", {
      p_merchandise_id: id,
      p_festival_id: admin.festivalId,
      p_slug: input.slug,
      p_name: input.name,
      p_tagline: input.tagline ?? "",
      p_description: input.description,
      p_details_markdown: input.detailsMarkdown ?? "",
      p_category: input.category,
      p_price_paise: pricePaise,
      p_images: input.images,
      p_sizes: input.sizes,
      p_stock_units: input.stockUnits,
      p_sales_state: input.salesState,
      p_status: input.status,
      p_featured: input.featured,
      p_sort_order: input.sortOrder,
      p_expected_version: input.version,
    });

    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(admin.festivalId, ["merchandise"]);

    return apiSuccess(req, { merchandise: data });
  } catch (err) {
    return apiFromError(req, err);
  }
}
