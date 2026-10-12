import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { rupeesToPaise } from "@/lib/money";
import { readJsonBody } from "@/lib/route-utils";
import { merchandiseAdminSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/merchandise — paginated admin merchandise product list.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await guardAdminRead(req, "content.merchandise.read");
    const sb = await createServerSupabase();

    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? "20") || 20)
    );
    const search = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const status = req.nextUrl.searchParams.get("status");

    let query = sb
      .from("merchandise_products")
      .select(
        `id, slug, name, tagline, description, details_markdown, category, price_paise,
         images, sizes, stock_units, held_units, confirmed_units, sales_state,
         status, featured, sort_order, version, created_at, updated_at`,
        { count: "exact" }
      )
      .eq("festival_id", ctx.festivalId)
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (search) query = query.ilike("name", `%${search}%`);
    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) return apiError(req, "INTERNAL", "Could not load merchandise products");

    const merchandise = (data ?? []).map((item) => ({
      id: item.id,
      slug: item.slug,
      name: item.name,
      tagline: item.tagline,
      description: item.description,
      detailsMarkdown: item.details_markdown,
      category: item.category,
      pricePaise: Number(item.price_paise),
      images: Array.isArray(item.images) ? item.images : [],
      sizes: Array.isArray(item.sizes) ? item.sizes : [],
      stockUnits: Number(item.stock_units),
      heldUnits: Number(item.held_units),
      confirmedUnits: Number(item.confirmed_units),
      availableUnits: Math.max(0, Number(item.stock_units) - Number(item.held_units) - Number(item.confirmed_units)),
      salesState: item.sales_state,
      status: item.status,
      featured: item.featured,
      sortOrder: item.sort_order,
      version: item.version,
      createdAt: item.created_at,
    }));

    return apiSuccess(req, {
      page,
      pageSize,
      total: count ?? merchandise.length,
      merchandise,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/**
 * POST /api/admin/merchandise — create a new merchandise product.
 */
export async function POST(req: NextRequest) {
  try {
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
      p_merchandise_id: null,
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
      p_expected_version: 0,
    });

    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(admin.festivalId, ["merchandise"]);

    return apiSuccess(req, { merchandise: data }, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
