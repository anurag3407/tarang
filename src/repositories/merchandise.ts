import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { MerchandiseProductRead } from "@/domain/content";

/**
 * Public merchandise repository.
 *
 * Reads published merchandise catalog items with calculated available units.
 */
export async function getPublishedMerchandise(
  festivalId: string
): Promise<MerchandiseProductRead[]> {
  const sb = createServiceRoleClient();

  const { data, error } = await sb
    .from("merchandise_products")
    .select(
      `id, slug, name, tagline, description, details_markdown, category,
       price_paise, currency, images, sizes, stock_units, held_units, confirmed_units,
       sales_state, status, featured, sort_order`
    )
    .eq("festival_id", festivalId)
    .eq("status", "PUBLISHED")
    .order("featured", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return data.map((item) => {
    const stock = Number(item.stock_units ?? 0);
    const held = Number(item.held_units ?? 0);
    const confirmed = Number(item.confirmed_units ?? 0);
    const availableUnits = Math.max(0, stock - held - confirmed);

    return {
      id: item.id,
      slug: item.slug,
      name: item.name,
      tagline: item.tagline ?? "",
      description: item.description ?? "",
      detailsMarkdown: item.details_markdown ?? null,
      category: item.category ?? "Apparel",
      pricePaise: Number(item.price_paise),
      currency: item.currency ?? "INR",
      images: Array.isArray(item.images) ? item.images : [],
      sizes: Array.isArray(item.sizes) ? item.sizes : ["S", "M", "L", "XL", "XXL"],
      stockUnits: stock,
      availableUnits,
      salesState: item.sales_state,
      status: item.status,
      featured: Boolean(item.featured),
      sortOrder: Number(item.sort_order ?? 0),
    };
  });
}

export async function getPublishedMerchandiseBySlug(
  festivalId: string,
  slug: string
): Promise<MerchandiseProductRead | null> {
  const sb = createServiceRoleClient();

  const { data: rawData, error } = await sb
    .from("merchandise_products")
    .select(
      `id, slug, name, tagline, description, details_markdown, category,
       price_paise, currency, images, sizes, stock_units, held_units, confirmed_units,
       sales_state, status, featured, sort_order`
    )
    .eq("festival_id", festivalId)
    .eq("slug", slug)
    .eq("status", "PUBLISHED")
    .maybeSingle();

  if (error || !rawData) return null;
  const data = (Array.isArray(rawData) ? rawData[0] : rawData) as typeof rawData | undefined;
  if (!data || !data.id) return null;

  const stock = Number(data.stock_units ?? 0);
  const held = Number(data.held_units ?? 0);
  const confirmed = Number(data.confirmed_units ?? 0);
  const availableUnits = Math.max(0, stock - held - confirmed);

  return {
    id: data.id,
    slug: data.slug,
    name: data.name,
    tagline: data.tagline ?? "",
    description: data.description ?? "",
    detailsMarkdown: data.details_markdown ?? null,
    category: data.category ?? "Apparel",
    pricePaise: Number(data.price_paise),
    currency: data.currency ?? "INR",
    images: Array.isArray(data.images) ? data.images : [],
    sizes: Array.isArray(data.sizes) ? data.sizes : ["S", "M", "L", "XL", "XXL"],
    stockUnits: stock,
    availableUnits,
    salesState: data.sales_state,
    status: data.status,
    featured: Boolean(data.featured),
    sortOrder: Number(data.sort_order ?? 0),
  };
}
