import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/route-utils";
import { noticeAdminSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/** GET /api/admin/notices — all notices incl. scheduled/archived. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await guardAdminRead(req, "content.notice.write");
    const sb = await createServerSupabase();

    const { data, error } = await sb
      .from("notices")
      .select(
        "id, slug, tag, title, body_markdown, publish_at, expires_at, pinned, status, version"
      )
      .eq("festival_id", ctx.festivalId)
      .order("publish_at", { ascending: false })
      .limit(200);
    if (error) return apiError(req, "INTERNAL", "Could not load notices");

    const notices = (data ?? []).map((n) => ({
      id: n.id,
      slug: n.slug,
      tag: n.tag,
      title: n.title,
      bodyMarkdown: n.body_markdown,
      publishAt: n.publish_at,
      expiresAt: n.expires_at,
      pinned: n.pinned,
      status: n.status,
      version: n.version,
    }));
    return apiSuccess(req, { notices });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/** POST /api/admin/notices — create a notice (plan §11.8). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await guardAdminMutation(req, "content.notice.write");
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
      p_notice_id: null,
      p_festival_id: ctx.festivalId,
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

    await invalidateContentCache(ctx.festivalId, ["notices"]);
    return apiSuccess(req, { notice: data }, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
