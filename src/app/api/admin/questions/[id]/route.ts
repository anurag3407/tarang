import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]),
    resolutionNote: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();

/**
 * PATCH /api/admin/questions/:id — move ticket state (plan §11.9).
 * Resolution writes audit; Phase 3 adds the reply email.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/questions/[id]">
) {
  try {
    const { id } = await ctx.params;
    await guardAdminMutation(req, "support.resolve");
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid update");
    }
    const { status, resolutionNote } = parsed.data;

    const sb = await createServerSupabase();
    const update: Record<string, unknown> = { status };
    if (status === "RESOLVED") {
      update.resolved_at = new Date().toISOString();
      update.resolution_note = resolutionNote ?? null;
    } else if (resolutionNote !== undefined) {
      update.resolution_note = resolutionNote;
    }

    const { data, error } = await sb
      .from("support_questions")
      .update(update)
      .eq("id", id)
      .select("id, status")
      .maybeSingle();
    if (error || !data) {
      return apiError(req, "NOT_FOUND", "Question not found");
    }

    await sb.rpc("write_audit", {
      p_action: "support.resolve",
      p_target_type: "support_question",
      p_target_id: id,
      p_metadata: { status },
    });

    return apiSuccess(req, { questionId: id, status });
  } catch (err) {
    return apiFromError(req, err);
  }
}
