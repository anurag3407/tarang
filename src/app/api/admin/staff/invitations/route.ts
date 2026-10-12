import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { staffInviteSchema } from "@/lib/validation/schemas";
import { readJsonBody } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/staff/invitations — invite staff (plan §11.5).
 *
 * The invitee must already have an account (they sign up first); the
 * assignment is created INVITED and activates after admin onboarding
 * (TOTP/AAL2). Audit written as the actor.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await guardAdminMutation(req, "staff.manage");
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = staffInviteSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid invitation", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const { email, roleId, eventIds } = parsed.data;

    const sb = createServiceRoleClient();

    // Resolve the invitee's existing account (auth-js 2.112 dropped
    // getUserByEmail; the RPC is service_role-only — see migration 0010).
    const { data: inviteeUserId, error: lookupErr } = await sb.rpc(
      "resolve_user_id_by_email",
      { p_email: email }
    );
    if (lookupErr || !inviteeUserId) {
      return apiError(
        req,
        "VALIDATION_FAILED",
        "No account found for that email — ask them to sign up first"
      );
    }

    const userSb = await createServerSupabase();
    const { data: role, error: roleErr } = await userSb
      .from("roles")
      .select("id, name")
      .eq("id", roleId)
      .maybeSingle();
    if (roleErr || !role) {
      return apiError(req, "NOT_FOUND", "Role not found");
    }

    const { data: assignment, error } = await sb
      .from("staff_assignments")
      .insert({
        festival_id: ctx.festivalId,
        user_id: inviteeUserId,
        role_id: roleId,
        status: "INVITED",
        invited_by: ctx.userId,
        invited_email: email,
      })
      .select("id")
      .single();
    if (error) {
      return apiError(req, "CONFLICT", "Invitation could not be created");
    }

    if (eventIds && eventIds.length > 0) {
      await sb.from("staff_event_scopes").insert(
        eventIds.map((eventId) => ({
          staff_assignment_id: assignment.id,
          event_id: eventId,
        }))
      );
    }

    await userSb.rpc("write_audit", {
      p_action: "staff.invite",
      p_target_type: "staff_assignment",
      p_target_id: assignment.id,
      p_metadata: { role: role.name },
    });

    return apiSuccess(req, { assignmentId: assignment.id }, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
