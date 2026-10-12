import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/route-utils";
import { sponsorAdminSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/** PATCH /api/admin/sponsors/:id — update sponsor. */
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const auth = await guardAdminMutation(req, "content.sponsor.write");
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
      p_sponsor_id: id,
      p_festival_id: auth.festivalId,
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

    await invalidateContentCache(auth.festivalId, ["sponsors"]);
    return apiSuccess(req, { sponsor: data });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/** DELETE /api/admin/sponsors/:id — delete sponsor. */
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const auth = await guardAdminMutation(req, "content.sponsor.write");

    const sb = await createServerSupabase();
    const { error } = await sb
      .from("sponsors")
      .delete()
      .eq("id", id)
      .eq("festival_id", auth.festivalId);

    if (error) return apiError(req, "INTERNAL", "Could not delete sponsor");

    await invalidateContentCache(auth.festivalId, ["sponsors"]);
    return apiSuccess(req, { deleted: true });
  } catch (err) {
    return apiFromError(req, err);
  }
}
