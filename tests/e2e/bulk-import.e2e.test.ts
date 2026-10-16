import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  EVENT_ID,
  PRODUCT_ID,
  USER_ID,
  resetWorld,
  sb,
  userSb,
} from "./helpers/mocks";
import {
  post,
  json,
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
vi.mock("@/services/qr-service", () => ({
  issueQrCredential: vi.fn().mockResolvedValue({ credentialId: "cred-1", jti: "jti-1" }),
  generatePassQrDataUrl: vi.fn().mockResolvedValue({ dataUrl: "data:image/png;base64,mockqr", token: "tok-1", expiresAt: "2026-09-01T00:00:00Z" }),
}));
vi.mock("@/workers/outbox-dispatcher", () => ({
  runEmailDispatcher: vi.fn().mockResolvedValue({ submitted: 1, failed: 0, dead: 0 }),
}));
vi.mock("@/repositories/public-content", () => ({
  getCurrentFestivalId: vi.fn().mockResolvedValue("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
}));

import { POST as bulkImportRoute } from "@/app/api/admin/bulk-import/route";

beforeEach(() => {
  resetWorld({ actor: { id: ADMIN_ID, email: "admin@example.com", confirmed: true } });
});

describe("POST /api/admin/bulk-import", () => {
  it("401s when actor is not logged in", async () => {
    resetWorld({ actor: null });
    const res = await bulkImportRoute(
      post("/api/admin/bulk-import", {
        body: {
          issuanceType: "PASS",
          users: [{ name: "Aarav", email: "aarav@example.com" }],
        },
      })
    );
    expect(res.status).toBe(401);
    expectErrEnvelope(await json(res), "UNAUTHORIZED");
  });

  it("403s when actor lacks pass.reissue permission", async () => {
    userSb.onRpc("has_permission", { data: false, error: null });
    const res = await bulkImportRoute(
      post("/api/admin/bulk-import", {
        body: {
          issuanceType: "PASS",
          users: [{ name: "Aarav", email: "aarav@example.com" }],
        },
      })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });

  it("creates new users, profiles, passes, and email jobs for VIP delegate passes", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });

    // pass_products query
    sb.onTable("pass_products", {
      data: {
        id: PRODUCT_ID,
        name: "VIP All-Access Delegate Pass",
        slug: "vip-delegate-pass",
        valid_until: "2026-09-30T00:00:00Z",
        current_price_version_id: "pv-1",
        is_base_pass: false,
      },
      error: null,
    });

    // resolve_user_id_by_email: user not found -> triggers createUser
    sb.onRpc("resolve_user_id_by_email", { data: null, error: null });

    // profiles upsert
    sb.onTable("profiles", { data: null, error: null });

    // existing pass check -> none
    sb.onTable("delegate_passes", { data: null, error: null });

    // orders insert
    sb.onTable("orders", { data: null, error: null });

    // order_lines insert
    sb.onTable("order_lines", { data: null, error: null });

    // delegate_passes insert
    sb.onTable("delegate_passes", {
      data: { id: "pass-new-1", public_pass_code: "PP-VIP001" },
      error: null,
    });

    // email_jobs upsert
    sb.onTable("email_jobs", { data: null, error: null });

    const res = await bulkImportRoute(
      post("/api/admin/bulk-import", {
        body: {
          issuanceType: "PASS",
          passSlug: "vip-delegate-pass",
          sendEmail: true,
          users: [
            {
              name: "Dr. Ramesh Kumar",
              email: "ramesh@aiims.edu",
              phone: "9876543210",
              college: "AIIMS New Delhi",
            },
          ],
        },
      })
    );

    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.processed).toBe(1);
    expect(body.data.successful).toBe(1);
    expect(body.data.failed).toBe(0);
    expect(body.data.results[0].passCode).toBe("PP-VIP001");
    expect(body.data.results[0].userCreated).toBe(true);

    const emailUpsert = sb.callsFor("email_jobs").find((c) => c.action === "upsert");
    expect(emailUpsert).toBeDefined();
    expect((emailUpsert?.payload as Record<string, unknown>).template_name).toBe(
      "delegate-pass-confirmation"
    );
  });

  it("attaches pass to existing user without creating duplicate account", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });

    sb.onTable("pass_products", {
      data: {
        id: PRODUCT_ID,
        name: "VIP All-Access Delegate Pass",
        slug: "vip-delegate-pass",
        valid_until: "2026-09-30T00:00:00Z",
        current_price_version_id: "pv-1",
        is_base_pass: false,
      },
      error: null,
    });

    // Existing user found
    sb.onRpc("resolve_user_id_by_email", { data: USER_ID, error: null });
    sb.onTable("profiles", { data: null, error: null });
    sb.onTable("delegate_passes", { data: null, error: null }); // no active pass yet
    sb.onTable("orders", { data: null, error: null });
    sb.onTable("order_lines", { data: null, error: null });
    sb.onTable("delegate_passes", {
      data: { id: "pass-new-2", public_pass_code: "PP-VIP002" },
      error: null,
    });
    sb.onTable("email_jobs", { data: null, error: null });

    const res = await bulkImportRoute(
      post("/api/admin/bulk-import", {
        body: {
          issuanceType: "PASS",
          sendEmail: true,
          users: [{ name: "Existing User", email: "existing@example.com" }],
        },
      })
    );

    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.successful).toBe(1);
    expect(body.data.results[0].userCreated).toBe(false);
    expect(body.data.results[0].userId).toBe(USER_ID);
    expect(body.data.results[0].passCode).toBe("PP-VIP002");
  });

  it("issues event registration when issuanceType is EVENT", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });

    sb.onTable("events", {
      data: {
        id: EVENT_ID,
        name: "Tarang Battle of the Bands",
        slug: "battle-of-the-bands",
        starts_at: "2026-09-25T18:00:00Z",
        ends_at: "2026-09-25T21:00:00Z",
        current_price_version_id: "epv-1",
        venues: { name: "Central Lawns", short_name: "Lawns" },
      },
      error: null,
    });

    sb.onRpc("resolve_user_id_by_email", { data: USER_ID, error: null });
    sb.onTable("profiles", { data: null, error: null });
    sb.onTable("registrations", { data: null, error: null }); // no prior registration
    sb.onTable("orders", { data: null, error: null });
    sb.onTable("order_lines", { data: null, error: null });
    sb.onTable("registrations", {
      data: { id: "reg-new-1", public_registration_code: "PR-BAND01" },
      error: null,
    });
    sb.onTable("registration_members", { data: null, error: null });
    sb.onTable("email_jobs", { data: null, error: null });

    const res = await bulkImportRoute(
      post("/api/admin/bulk-import", {
        body: {
          issuanceType: "EVENT",
          eventId: EVENT_ID,
          sendEmail: true,
          users: [{ name: "Musician", email: "musician@example.com" }],
        },
      })
    );

    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.successful).toBe(1);
    expect(body.data.results[0].registrationCode).toBe("PR-BAND01");

    const emailUpsert = sb.callsFor("email_jobs").find((c) => c.action === "upsert");
    expect(emailUpsert).toBeDefined();
    expect((emailUpsert?.payload as Record<string, unknown>).template_name).toBe(
      "event-registration-confirmation"
    );
  });

  it("validates payload and rejects empty users array or invalid email", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });

    const res1 = await bulkImportRoute(
      post("/api/admin/bulk-import", {
        body: {
          issuanceType: "PASS",
          users: [],
        },
      })
    );
    expect(res1.status).toBe(422);
    expectErrEnvelope(await json(res1), "VALIDATION_FAILED");

    userSb.onRpc("has_permission", { data: true, error: null });
    const res2 = await bulkImportRoute(
      post("/api/admin/bulk-import", {
        body: {
          issuanceType: "PASS",
          users: [{ name: "Bad", email: "not-an-email" }],
        },
      })
    );
    expect(res2.status).toBe(422);
    expectErrEnvelope(await json(res2), "VALIDATION_FAILED");
  });
});

import { POST as fetchSheetRoute } from "@/app/api/admin/fetch-sheet/route";

describe("POST /api/admin/fetch-sheet", () => {
  it("extracts sheet ID and parses Google Sheet CSV export", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        "Name,Email,Phone,College\nDr. Ramesh Kumar,ramesh@aiims.edu,9876543210,AIIMS New Delhi",
    });
    const originalFetch = global.fetch;
    global.fetch = mockFetch as unknown as typeof fetch;

    try {
      const res = await fetchSheetRoute(
        post("/api/admin/fetch-sheet", {
          body: {
            url: "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0",
          },
        })
      );

      expect(res.status).toBe(200);
      const body = await json(res);
      expectOkEnvelope(body);
      expect(body.data.sheetId).toBe("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms");
      expect(body.data.csvText).toContain("Dr. Ramesh Kumar");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("422s when URL is missing or invalid", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });

    const res = await fetchSheetRoute(
      post("/api/admin/fetch-sheet", {
        body: { url: "" },
      })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });

  it("never overwrites an existing user's own profile details", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("pass_products", {
      data: {
        id: PRODUCT_ID,
        name: "VIP All-Access Delegate Pass",
        slug: "vip-delegate-pass",
        valid_until: "2026-09-30T00:00:00Z",
        current_price_version_id: "pv-1",
        is_base_pass: false,
      },
      error: null,
    });
    sb.onRpc("resolve_user_id_by_email", { data: USER_ID, error: null });
    sb.onTable("profiles", {
      data: {
        user_id: USER_ID,
        display_name: "Real Name",
        phone_e164: "+919811111111",
        college_name: "Real College",
        profile_completed_at: "2026-08-01T00:00:00Z",
        consented_at: "2026-08-01T00:00:00Z",
      },
      error: null,
    });
    sb.onTable("profiles", { data: null, error: null });
    sb.onTable("delegate_passes", { data: { id: "pass-1", public_pass_code: "PP-1", state: "ACTIVE" }, error: null });

    const res = await bulkImportRoute(
      post("/api/admin/bulk-import", {
        body: {
          issuanceType: "PASS",
          users: [{ name: "Sheet Name", email: "real@example.com" }],
        },
      })
    );
    expectOkEnvelope(await json(res));
    const upsert = sb.callsFor("profiles").find((c) => c.action === "upsert");
    expect(upsert?.payload).toMatchObject({
      display_name: "Real Name",
      phone_e164: "+919811111111",
      college_name: "Real College",
      profile_completed_at: "2026-08-01T00:00:00Z",
    });
  });
});

