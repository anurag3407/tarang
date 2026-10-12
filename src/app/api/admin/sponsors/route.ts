import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/route-utils";
import { sponsorAdminSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/** GET /api/admin/sponsors — all sponsors for active festival. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await guardAdminRead(req, "content.sponsor.write");
    const sb = await createServerSupabase();

    const { data, error } = await sb
      .from("sponsors")
      .select(
        "id, name, category, tagline, logo_url, website_url, color_key, sort_order, is_title, is_active, version, created_at, updated_at"
      )
      .eq("festival_id", ctx.festivalId)
      .order("is_title", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(100);

    if (error) return apiError(req, "INTERNAL", "Could not load sponsors");

    const sponsors = (data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      tagline: s.tagline,
      logoUrl: s.logo_url,
      websiteUrl: s.website_url,
      colorKey: s.color_key,
      sortOrder: s.sort_order,
      isTitle: s.is_title,
      isActive: s.is_active,
      version: s.version,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));

    return apiSuccess(req, { sponsors });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/** POST /api/admin/sponsors — create a new sponsor. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await guardAdminMutation(req, "content.sponsor.write");
    const body = await readJsonBody<Record<string, unknown>>(req, 64 * 1024);
    const parsed = sponsorAdminSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid sponsor data", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const input = parsed.data;

    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("admin_upsert_sponsor", {
      p_sponsor_id: null,
      p_festival_id: ctx.festivalId,
      p_name: input.name,
      p_category: input.category,
      p_tagline: input.tagline,
      p_logo_url: input.logoUrl,
      p_website_url: input.websiteUrl || null,
      p_color_key: input.colorKey,
      p_sort_order: input.sortOrder,
      p_is_title: input.isTitle,
      p_is_active: input.isActive,
      p_expected_version: input.version,
    });

    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(ctx.festivalId, ["sponsors"]);
    return apiSuccess(req, { sponsor: data }, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
