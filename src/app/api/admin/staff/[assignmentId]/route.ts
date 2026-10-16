import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readJsonBody, requireUuid } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

const patchSchema = z
  .object({
    action: z.enum(["ACTIVATE", "SUSPEND", "REVOKE"]),
    eventIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict();

/**
 * PATCH /api/admin/staff/:assignmentId — activate/suspend/revoke (plan §11.5).
 *
 * Last-superadmin protection: the final active superadmin cannot be
 * suspended or revoked.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/staff/[assignmentId]">
) {
  try {
    const assignmentId = requireUuid((await ctx.params).assignmentId, "Staff assignment");
    await guardAdminMutation(req, "staff.manage");

    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid action");
    }
    const { action, eventIds } = parsed.data;

    const sb = createServiceRoleClient();
    const { data: assignment, error: fetchErr } = await sb
      .from("staff_assignments")
      .select("id, user_id, role_id, status, roles ( is_superadmin )")
      .eq("id", assignmentId)
      .single();
    if (fetchErr || !assignment) {
      return apiError(req, "NOT_FOUND", "Assignment not found");
    }
    const role = Array.isArray(assignment.roles)
      ? assignment.roles[0]
      : assignment.roles;

    if (action !== "ACTIVATE" && role?.is_superadmin) {
      const { data: count } = await sb.rpc("active_superadmin_count");
      if (Number(count ?? 0) <= 1 && assignment.status === "ACTIVE") {
        return apiError(
          req,
          "CONFLICT",
          "Cannot remove the last active superadmin"
        );
      }
    }

    const now = new Date().toISOString();
    const update =
      action === "ACTIVATE"
        ? { status: "ACTIVE", activated_at: now, revoked_at: null }
        : action === "SUSPEND"
          ? { status: "SUSPENDED" }
          : { status: "REVOKED", revoked_at: now };

    const { error } = await sb
      .from("staff_assignments")
      .update(update)
      .eq("id", assignmentId);
    if (error) {
      return apiError(req, "INTERNAL", "Update failed");
    }

    if (eventIds !== undefined) {
      await sb
        .from("staff_event_scopes")
        .delete()
        .eq("staff_assignment_id", assignmentId);
      if (eventIds.length > 0) {
        await sb.from("staff_event_scopes").insert(
          eventIds.map((eventId) => ({
            staff_assignment_id: assignmentId,
            event_id: eventId,
          }))
        );
      }
    }

    const userSb = await createServerSupabase();
    await userSb.rpc("write_audit", {
      p_action: `staff.${action.toLowerCase()}`,
      p_target_type: "staff_assignment",
      p_target_id: assignmentId,
    });

    return apiSuccess(req, { assignmentId, status: update.status });
  } catch (err) {
    return apiFromError(req, err);
  }
}
