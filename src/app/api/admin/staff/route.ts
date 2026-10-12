import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminRead } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/admin/staff — list staff assignments (plan §11.5). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await guardAdminRead(req, "staff.manage");
    const sb = await createServerSupabase();

    const { data, error } = await sb
      .from("staff_assignments")
      .select(
        `id, user_id, role_id, status, invited_email, activated_at, created_at,
         roles ( name ),
         staff_event_scopes ( event_id )`
      )
      .eq("festival_id", ctx.festivalId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return apiError(req, "INTERNAL", "Could not load staff");

    const staff = (data ?? []).map((row) => {
      const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
      const scopes = Array.isArray(row.staff_event_scopes)
        ? row.staff_event_scopes.map((s: { event_id: string }) => s.event_id)
        : [];
      return {
        id: row.id,
        userId: row.user_id,
        email: row.invited_email,
        displayName: null,
        roleId: row.role_id,
        roleName: role?.name ?? "",
        status: row.status,
        invitedAt: row.created_at,
        activatedAt: row.activated_at,
        eventScopes: scopes,
      };
    });
    return apiSuccess(req, { staff });
  } catch (err) {
    return apiFromError(req, err);
  }
}
