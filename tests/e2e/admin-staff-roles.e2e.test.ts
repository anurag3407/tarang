import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  EVENT_ID,
  FESTIVAL_ID,
  MEMBER_ID,
  ROLE_ID,
  resetWorld,
  sb,
  userSb,
} from "./helpers/mocks";
import {
  ctx,
  get,
  json,
  post,
  expectOkEnvelope,
  expectErrEnvelope,
} from "./helpers/requests";

vi.mock("@/lib/supabase/service-role", async () => {
  const m = await import("./helpers/mocks");
  return { createServiceRoleClient: () => m.sb };
});
vi.mock("@/lib/supabase/server", async () => {
  const m = await import("./helpers/mocks");
  return { createServerSupabase: async () => m.userSb };
});
vi.mock("@/lib/redis/rate-limits", async () => {
  const m = await import("./helpers/mocks");
  return {
    checkRateLimit: m.rateLimiter.checkRateLimit.bind(m.rateLimiter),
    enforceRateLimit: m.rateLimiter.enforceRateLimit.bind(m.rateLimiter),
  };
});

import { GET as staffListRoute } from "@/app/api/admin/staff/route";
import { POST as staffInviteRoute } from "@/app/api/admin/staff/invitations/route";
import { PATCH as staffPatchRoute } from "@/app/api/admin/staff/[assignmentId]/route";
import { GET as rolesListRoute, POST as roleCreateRoute } from "@/app/api/admin/roles/route";
import { PATCH as rolePatchRoute } from "@/app/api/admin/roles/[id]/route";

const ASSIGNMENT_ID = "a5519e00-a551-4a55-8a55-a5519e00a551";
const NEW_ROLE_ID = "0e00001e-0e00-4e00-8e00-0e00001e0e00";

beforeEach(() => {
  resetWorld({ actor: { id: ADMIN_ID, email: "admin@example.com", confirmed: true } });
});

describe("GET /api/admin/staff (plan §11.5)", () => {
  it("lists assignments with role names and event scopes", async () => {
    userSb.onRpc("has_permission", { data: true, error: null }); // staff.manage
    userSb.onTable("staff_assignments", {
      data: [
        {
          id: ASSIGNMENT_ID,
          user_id: ADMIN_ID,
          role_id: ROLE_ID,
          status: "ACTIVE",
          invited_email: "gateops@example.com",
          activated_at: "2026-08-01T00:00:00Z",
          created_at: "2026-07-31T00:00:00Z",
          roles: [{ name: "Superadmin" }],
          staff_event_scopes: [{ event_id: EVENT_ID }],
        },
      ],
      error: null,
    });

    const res = await staffListRoute(get("/api/admin/staff"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect((body.data.staff as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: ASSIGNMENT_ID,
      roleName: "Superadmin",
      status: "ACTIVE",
      eventScopes: [EVENT_ID],
    });
  });

  it("403s without staff.manage", async () => {
    userSb.onRpc("has_permission", { data: false, error: null });

    const res = await staffListRoute(get("/api/admin/staff"));
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });
});

describe("POST /api/admin/staff/invitations (plan §11.5)", () => {
  function grant(): void {
    userSb.onRpc("has_permission", { data: true, error: null });
  }

  const inviteBody = {
    email: "newstaff@example.com",
    roleId: ROLE_ID,
    eventIds: [EVENT_ID],
  };

  it("creates an INVITED assignment with scopes and an audit entry", async () => {
    grant();
    sb.onRpc("resolve_user_id_by_email", { data: MEMBER_ID, error: null });
    userSb.onTable("roles", { data: { id: ROLE_ID, name: "Scanner Op" }, error: null });
    sb.onTable("staff_assignments", { data: { id: ASSIGNMENT_ID }, error: null });
    sb.onTable("staff_event_scopes", { data: null, error: null }); // scope insert
    userSb.onRpc("write_audit", { data: null, error: null });

    const res = await staffInviteRoute(post("/api/admin/staff/invitations", { body: inviteBody }));
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.assignmentId).toBe(ASSIGNMENT_ID);

    const insert = sb.callsFor("staff_assignments").find((c) => c.action === "insert")!;
    expect(insert.payload).toMatchObject({
      user_id: MEMBER_ID,
      role_id: ROLE_ID,
      status: "INVITED",
      invited_email: "newstaff@example.com",
    });
    const audit = userSb.rpcParams("write_audit")!;
    expect(audit).toMatchObject({ p_action: "staff.invite" });
    expect((audit.p_metadata as Record<string, unknown>).role).toBe("Scanner Op");
  });

  it("422s when the invitee has no account yet", async () => {
    grant();
    sb.onRpc("resolve_user_id_by_email", { data: null, error: null });

    const res = await staffInviteRoute(post("/api/admin/staff/invitations", { body: inviteBody }));
    expect(res.status).toBe(422);
    const body = await json(res);
    expectErrEnvelope(body, "VALIDATION_FAILED");
    expect(body.message).toMatch(/ask them to sign up first/i);
  });

  it("404s an unknown role", async () => {
    grant();
    sb.onRpc("resolve_user_id_by_email", { data: MEMBER_ID, error: null });
    userSb.onTable("roles", { data: null, error: null });

    const res = await staffInviteRoute(post("/api/admin/staff/invitations", { body: inviteBody }));
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });

  it("409s when the insert fails (duplicate assignment)", async () => {
    grant();
    sb.onRpc("resolve_user_id_by_email", { data: MEMBER_ID, error: null });
    userSb.onTable("roles", { data: { id: ROLE_ID, name: "Scanner Op" }, error: null });
    sb.onTable("staff_assignments", {
      data: null,
      error: { message: "duplicate key value violates unique constraint" },
    });

    const res = await staffInviteRoute(post("/api/admin/staff/invitations", { body: inviteBody }));
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "CONFLICT");
  });

  it("422s a malformed payload before any DB access", async () => {
    grant();

    const res = await staffInviteRoute(
      post("/api/admin/staff/invitations", { body: { email: "not-an-email", roleId: ROLE_ID } })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
    expect(sb.calls.length).toBe(0);
  });
});

describe("PATCH /api/admin/staff/:assignmentId (plan §11.5)", () => {
  function seedAssignment(status: string, isSuperadmin = false): void {
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("staff_assignments", {
      data: {
        id: ASSIGNMENT_ID,
        user_id: MEMBER_ID,
        role_id: ROLE_ID,
        status,
        roles: { is_superadmin: isSuperadmin },
      },
      error: null,
    });
  }

  it("activates a pending assignment and replaces its event scopes atomically", async () => {
    seedAssignment("INVITED");
    sb.onTable("staff_assignments", { data: null, error: null }); // update
    sb.onTable("staff_event_scopes", { data: null, error: null }); // delete
    sb.onTable("staff_event_scopes", { data: null, error: null }); // insert
    userSb.onRpc("write_audit", { data: null, error: null });

    const res = await staffPatchRoute(
      post(`/api/admin/staff/${ASSIGNMENT_ID}`, {
        body: { action: "ACTIVATE", eventIds: [EVENT_ID] },
      }),
      ctx({ assignmentId: ASSIGNMENT_ID })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.status).toBe("ACTIVE");

    const update = sb.callsFor("staff_assignments").find((c) => c.action === "update")!;
    expect(update.payload).toMatchObject({ status: "ACTIVE", revoked_at: null });
    const deletes = sb.callsFor("staff_event_scopes").filter((c) => c.action === "delete");
    const inserts = sb.callsFor("staff_event_scopes").filter((c) => c.action === "insert");
    expect(deletes.length).toBe(1);
    expect(inserts.length).toBe(1);
    expect(userSb.rpcParams("write_audit")?.p_action).toBe("staff.activate");
  });

  it("protects the last active superadmin from suspension", async () => {
    seedAssignment("ACTIVE", true); // superadmin role
    sb.onRpc("active_superadmin_count", { data: 1, error: null }); // scalar count

    const res = await staffPatchRoute(
      post(`/api/admin/staff/${ASSIGNMENT_ID}`, { body: { action: "SUSPEND" } }),
      ctx({ assignmentId: ASSIGNMENT_ID })
    );
    expect(res.status).toBe(409);
    const body = await json(res);
    expectErrEnvelope(body, "CONFLICT");
    expect(body.message).toMatch(/last active superadmin/i);
    // No state was mutated.
    expect(sb.callsFor("staff_assignments").filter((c) => c.action === "update")).toHaveLength(0);
  });

  it("allows suspension while another active superadmin remains", async () => {
    seedAssignment("ACTIVE", true);
    sb.onRpc("active_superadmin_count", { data: 2, error: null });
    sb.onTable("staff_assignments", { data: null, error: null }); // update

    const res = await staffPatchRoute(
      post(`/api/admin/staff/${ASSIGNMENT_ID}`, { body: { action: "SUSPEND" } }),
      ctx({ assignmentId: ASSIGNMENT_ID })
    );
    expect(res.status).toBe(200);
    const update = sb.callsFor("staff_assignments").find((c) => c.action === "update")!;
    expect(update.payload).toEqual({ status: "SUSPENDED" });
  });

  it("stamps revoked_at on REVOKE", async () => {
    seedAssignment("ACTIVE", false);
    sb.onTable("staff_assignments", { data: null, error: null });
    userSb.onRpc("write_audit", { data: null, error: null });

    const res = await staffPatchRoute(
      post(`/api/admin/staff/${ASSIGNMENT_ID}`, { body: { action: "REVOKE" } }),
      ctx({ assignmentId: ASSIGNMENT_ID })
    );
    expect(res.status).toBe(200);
    const update = sb.callsFor("staff_assignments").find((c) => c.action === "update")!;
    expect(update.payload).toMatchObject({ status: "REVOKED" });
    expect(typeof (update.payload as Record<string, unknown>).revoked_at).toBe("string");
  });

  it("404s an unknown assignment and 422s an invalid action", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("staff_assignments", { data: null, error: { message: "no rows" } });
    const missing = await staffPatchRoute(
      post(`/api/admin/staff/${ASSIGNMENT_ID}`, { body: { action: "ACTIVATE" } }),
      ctx({ assignmentId: ASSIGNMENT_ID })
    );
    expect(missing.status).toBe(404);

    userSb.reset();
    userSb.onRpc("has_permission", { data: true, error: null });
    const bad = await staffPatchRoute(
      post(`/api/admin/staff/${ASSIGNMENT_ID}`, { body: { action: "NUKE" } }),
      ctx({ assignmentId: ASSIGNMENT_ID })
    );
    expect(bad.status).toBe(422);
    expectErrEnvelope(await json(bad), "VALIDATION_FAILED");
  });
});

describe("GET /api/admin/roles (plan §11.5)", () => {
  it("extracts permission codes through the nested join", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    userSb.onTable("roles", {
      data: [
        {
          id: ROLE_ID,
          name: "Content Editor",
          description: null,
          is_system: true,
          is_superadmin: false,
          role_permissions: [
            { permissions: [{ code: "content.event.write" }] },
            { permissions: [{ code: "content.notice.write" }] },
          ],
        },
      ],
      error: null,
    });

    const res = await rolesListRoute(get("/api/admin/roles"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    const role = (body.data.roles as Array<Record<string, unknown>>)[0];
    expect(role.permissions).toEqual(["content.event.write", "content.notice.write"]);
    expect(role.isSystem).toBe(true);
  });

  it("returns all permissions for a Superadmin role", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    userSb.onTable("roles", {
      data: [
        {
          id: ROLE_ID,
          name: "Superadmin",
          description: "Full control",
          is_system: true,
          is_superadmin: true,
          role_permissions: [],
        },
      ],
      error: null,
    });

    const res = await rolesListRoute(get("/api/admin/roles"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    const role = (body.data.roles as Array<Record<string, unknown>>)[0];
    expect(role.isSuperadmin).toBe(true);
    expect(role.permissions).toContain("content.event.write");
    expect(role.permissions).toContain("scanner.use");
    expect(role.permissions).toContain("scanner.supervise");
    expect(role.permissions).toContain("staff.manage");
    expect(role.permissions).toContain("role.manage");
  });
});

describe("POST /api/admin/roles (plan §11.5)", () => {
  function grant(): void {
    userSb.onRpc("has_permission", { data: true, error: null });
  }

  it("refuses protected permissions for custom roles", async () => {
    grant();

    const res = await roleCreateRoute(
      post("/api/admin/roles", {
        body: { name: "Power Role", description: null, permissions: ["staff.manage"] },
      })
    );
    expect(res.status).toBe(403);
    const body = await json(res);
    expectErrEnvelope(body, "FORBIDDEN");
    expect(body.message).toContain("staff.manage");
    expect(sb.calls.length).toBe(0);
  });

  it("creates a custom role with its permission links + audit entry", async () => {
    grant();
    sb.onTable("roles", { data: { id: NEW_ROLE_ID }, error: null });
    sb.onTable("permissions", {
      data: [
        { id: "perm-1", code: "scanner.use" },
        { id: "perm-2", code: "support.read" },
      ],
      error: null,
    });
    sb.onTable("role_permissions", { data: null, error: null });
    userSb.onRpc("write_audit", { data: null, error: null });

    const res = await roleCreateRoute(
      post("/api/admin/roles", {
        body: { name: "Gate Ops", description: "Scans at gates", permissions: ["scanner.use", "support.read"] },
      })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.roleId).toBe(NEW_ROLE_ID);

    const insert = sb.callsFor("roles").find((c) => c.action === "insert")!;
    expect(insert.payload).toMatchObject({
      name: "Gate Ops",
      is_system: false,
      is_superadmin: false,
      festival_id: FESTIVAL_ID,
    });
    const links = sb.callsFor("role_permissions").find((c) => c.action === "insert")!;
    expect(links.payload).toHaveLength(2);
    expect(userSb.rpcParams("write_audit")).toMatchObject({
      p_action: "role.create",
      p_target_type: "role",
    });
  });

  it("409s on a duplicate role name", async () => {
    grant();
    sb.onTable("roles", {
      data: null,
      error: { message: "duplicate key value violates unique constraint roles_name_key" },
    });

    const res = await roleCreateRoute(
      post("/api/admin/roles", { body: { name: "Dup", description: null, permissions: [] } })
    );
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "CONFLICT");
  });

  it("422s invalid permission codes", async () => {
    grant();

    const res = await roleCreateRoute(
      post("/api/admin/roles", {
        body: { name: "Bad Perms", description: null, permissions: ["make.me.admin"] },
      })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });
});

describe("PATCH /api/admin/roles/:id (plan §11.5)", () => {
  function grant(): void {
    userSb.onRpc("has_permission", { data: true, error: null });
  }

  it("forbids modifying system or superadmin roles", async () => {
    grant();
    sb.onTable("roles", { data: { id: ROLE_ID, is_system: true, is_superadmin: false }, error: null });

    const res = await rolePatchRoute(
      post(`/api/admin/roles/${ROLE_ID}`, { body: { description: "hack" } }),
      ctx({ id: ROLE_ID })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
    expect(sb.callsFor("role_permissions")).toHaveLength(0);
  });

  it("updates description and swaps permissions for a custom role", async () => {
    grant();
    sb.onTable("roles", { data: { id: NEW_ROLE_ID, is_system: false, is_superadmin: false }, error: null });
    sb.onTable("roles", { data: null, error: null }); // description update
    sb.onTable("role_permissions", { data: null, error: null }); // delete all
    sb.onTable("permissions", { data: [{ id: "perm-7", code: "scanner.use" }], error: null });
    sb.onTable("role_permissions", { data: null, error: null }); // insert new
    userSb.onRpc("write_audit", { data: null, error: null });

    const res = await rolePatchRoute(
      post(`/api/admin/roles/${NEW_ROLE_ID}`, {
        body: { description: "Updated", permissions: ["scanner.use"] },
      }),
      ctx({ id: NEW_ROLE_ID })
    );
    expect(res.status).toBe(200);
    const updates = sb.callsFor("roles").filter((c) => c.action === "update");
    expect(updates[0].payload).toEqual({ description: "Updated" });
    expect(userSb.rpcParams("write_audit")?.p_action).toBe("role.update");
  });

  it("still refuses protected permissions during edits", async () => {
    grant();
    sb.onTable("roles", { data: { id: NEW_ROLE_ID, is_system: false, is_superadmin: false }, error: null });

    const res = await rolePatchRoute(
      post(`/api/admin/roles/${NEW_ROLE_ID}`, {
        body: { permissions: ["refund.approve"] },
      }),
      ctx({ id: NEW_ROLE_ID })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
    // Existing permission links untouched.
    expect(sb.callsFor("role_permissions").filter((c) => c.action === "delete")).toHaveLength(0);
  });

  it("404s an unknown role id", async () => {
    grant();
    sb.onTable("roles", { data: null, error: null });

    const res = await rolePatchRoute(
      post(`/api/admin/roles/${NEW_ROLE_ID}`, { body: { description: "x" } }),
      ctx({ id: NEW_ROLE_ID })
    );
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });
});
