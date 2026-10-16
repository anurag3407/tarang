import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readJsonBody, requireUuid } from "@/lib/route-utils";
import { PERMISSION_CODES } from "@/domain/auth";

export const dynamic = "force-dynamic";

const PROTECTED_PERMISSIONS = new Set([
  "staff.manage",
  "role.manage",
  "refund.approve",
  "pass.revoke",
  "pass.reissue",
  "feature_flag.write",
  "discount.manage",
]);

const patchRoleSchema = z
  .object({
    description: z.string().trim().max(300).nullable().optional(),
    permissions: z.array(z.enum(PERMISSION_CODES)).max(30).optional(),
  })
  .strict();

/**
 * PATCH /api/admin/roles/:id — edit a custom role (plan §11.5).
 * System roles and superadmin roles are immutable.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/roles/[id]">
) {
  try {
    const id = requireUuid((await ctx.params).id, "Role");
    await guardAdminMutation(req, "role.manage");

    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = patchRoleSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid role update");
    }

    const sb = createServiceRoleClient();
    const { data: role, error: fetchErr } = await sb
      .from("roles")
      .select("id, is_system, is_superadmin")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr || !role) {
      return apiError(req, "NOT_FOUND", "Role not found");
    }
    if (role.is_system || role.is_superadmin) {
      return apiError(req, "FORBIDDEN", "System roles cannot be modified");
    }

    if (parsed.data.description !== undefined) {
      await sb
        .from("roles")
        .update({ description: parsed.data.description })
        .eq("id", id);
    }

    if (parsed.data.permissions !== undefined) {
      const protectedRequested = parsed.data.permissions.filter((p) =>
        PROTECTED_PERMISSIONS.has(p)
      );
      if (protectedRequested.length > 0) {
        return apiError(
          req,
          "FORBIDDEN",
          `Protected permissions cannot be granted to custom roles: ${protectedRequested.join(", ")}`
        );
      }
      await sb.from("role_permissions").delete().eq("role_id", id);
      if (parsed.data.permissions.length > 0) {
        const { data: permRows } = await sb
          .from("permissions")
          .select("id, code")
          .in("code", parsed.data.permissions);
        await sb.from("role_permissions").insert(
          (permRows ?? []).map((p) => ({
            role_id: id,
            permission_id: p.id,
          }))
        );
      }
    }

    const userSb = await createServerSupabase();
    await userSb.rpc("write_audit", {
      p_action: "role.update",
      p_target_type: "role",
      p_target_id: id,
    });

    return apiSuccess(req, { roleId: id });
  } catch (err) {
    return apiFromError(req, err);
  }
}
