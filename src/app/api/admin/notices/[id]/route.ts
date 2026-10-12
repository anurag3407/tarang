import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/route-utils";
import { noticeAdminSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/** PATCH /api/admin/notices/:id — update with optimistic version. */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/notices/[id]">
) {
  try {
    const { id } = await ctx.params;
    const auth = await guardAdminMutation(req, "content.notice.write");
    const body = await readJsonBody<Record<string, unknown>>(req, 64 * 1024);
    const parsed = noticeAdminSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid notice", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const input = parsed.data;

    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("admin_upsert_notice", {
      p_notice_id: id,
      p_festival_id: auth.festivalId,
      p_slug: input.slug,
      p_tag: input.tag,
      p_title: input.title,
      p_body_markdown: input.bodyMarkdown,
      p_publish_at: input.publishAt,
      p_expires_at: input.expiresAt,
      p_pinned: input.pinned,
      p_expected_version: input.version,
    });
    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(auth.festivalId, ["notices"]);
    return apiSuccess(req, { notice: data });
  } catch (err) {
    return apiFromError(req, err);
  }
}
