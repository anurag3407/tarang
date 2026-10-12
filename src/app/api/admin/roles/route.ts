import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readJsonBody } from "@/lib/route-utils";
import { PERMISSION_CODES } from "@/domain/auth";

export const dynamic = "force-dynamic";

/**
 * Permissions only superadmin roles may hold (plan §11.5 "protected
 * permissions"). Custom roles can never be granted these.
 */
const PROTECTED_PERMISSIONS = new Set([
  "staff.manage",
  "role.manage",
  "refund.approve",
  "pass.revoke",
  "pass.reissue",
  "feature_flag.write",
]);

/** GET /api/admin/roles — roles with permission codes (plan §11.5). */
export async function GET(req: NextRequest) {
  try {
    await guardAdminRead(req, "role.manage");
    const sb = await createServerSupabase();

    const { data, error } = await sb
      .from("roles")
      .select(
        `id, name, description, is_system, is_superadmin,
         role_permissions ( permissions ( code ) )`
      )
      .order("name", { ascending: true });
    if (error) return apiError(req, "INTERNAL", "Could not load roles");

    const roles = (data ?? []).map((r) => {
      const explicitPerms = (r.role_permissions ?? [])
        .map((rp: { permissions: { code: string } | { code: string }[] }) => {
          const p = Array.isArray(rp.permissions)
            ? rp.permissions[0]
            : rp.permissions;
          return p?.code ?? "";
        })
        .filter(Boolean);

      return {
        id: r.id,
        name: r.name,
        description: r.description,
        isSystem: r.is_system,
        isSuperadmin: r.is_superadmin,
        permissions: r.is_superadmin
          ? Array.from(new Set([...PERMISSION_CODES, ...explicitPerms]))
          : explicitPerms,
      };
    });
    return apiSuccess(req, { roles });
  } catch (err) {
    return apiFromError(req, err);
  }
}

const createRoleSchema = z
  .object({
    name: z.string().trim().min(3).max(60),
    description: z.string().trim().max(300).nullable(),
    permissions: z.array(z.enum(PERMISSION_CODES)).max(30),
  })
  .strict();

/** POST /api/admin/roles — create a custom role (plan §11.5). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await guardAdminMutation(req, "role.manage");
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = createRoleSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid role", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const { name, description, permissions } = parsed.data;

    const protectedRequested = permissions.filter((p) =>
      PROTECTED_PERMISSIONS.has(p)
    );
    if (protectedRequested.length > 0) {
      return apiError(
        req,
        "FORBIDDEN",
        `Protected permissions cannot be granted to custom roles: ${protectedRequested.join(", ")}`
      );
    }

    const sb = createServiceRoleClient();
    const { data: role, error } = await sb
      .from("roles")
      .insert({
        festival_id: ctx.festivalId,
        name,
        description,
        is_system: false,
        is_superadmin: false,
      })
      .select("id")
      .single();
    if (error) {
      return apiError(req, "CONFLICT", "A role with that name already exists");
    }

    if (permissions.length > 0) {
      const { data: permRows } = await sb
        .from("permissions")
        .select("id, code")
        .in("code", permissions);
      await sb.from("role_permissions").insert(
        (permRows ?? []).map((p) => ({
          role_id: role.id,
          permission_id: p.id,
        }))
      );
    }

    const userSb = await createServerSupabase();
    await userSb.rpc("write_audit", {
      p_action: "role.create",
      p_target_type: "role",
      p_target_id: role.id,
      p_metadata: { name },
    });

    return apiSuccess(req, { roleId: role.id }, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
