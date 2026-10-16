import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetWorld, sb } from "./e2e/helpers/mocks";
import { post, json, expectOkEnvelope, expectErrEnvelope } from "./e2e/helpers/requests";

vi.mock("@/lib/supabase/service-role", async () => {
  const m = await import("./e2e/helpers/mocks");
  return { createServiceRoleClient: () => m.sb };
});
vi.mock("@/lib/redis/rate-limits", async () => {
  const m = await import("./e2e/helpers/mocks");
  return {
    checkRateLimit: m.rateLimiter.checkRateLimit.bind(m.rateLimiter),
    enforceRateLimit: m.rateLimiter.enforceRateLimit.bind(m.rateLimiter),
  };
});

import { POST as verifyRoute } from "@/app/api/public/verify/route";

const PASS_CODE = "PP-4F8A9C12E7B3";
const USER_ID = "11111111-1111-4111-8111-111111111111";
// Relative to now: a fixed date turns these "active pass" cases into expired ones.
const FUTURE_EXPIRY = new Date(Date.now() + 30 * 86_400_000).toISOString();

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld();
});

describe("POST /api/public/verify — Pass Authenticity & Verification", () => {
  it("verifies a real active delegate pass and returns purchase details", async () => {
    sb.onTable("delegate_passes", {
      data: [
        {
          id: "pass-1",
          public_pass_code: PASS_CODE,
          state: "ACTIVE",
          activated_at: "2026-08-20T10:00:00.000Z",
          created_at: "2026-08-20T10:00:00.000Z",
          expires_at: FUTURE_EXPIRY,
          user_id: USER_ID,
          pass_products: {
            id: "prod-1",
            name: "VIP All-Access Delegate Pass",
            slug: "vip-delegate-pass",
            is_base_pass: false,
            description: "All 5 Star Night Concerts + Campus Entry",
          },
          festivals: {
            id: "fest-1",
            name: "TARANG",
            year: 2026,
          },
        },
      ],
      error: null,
    });

    sb.onTable("profiles", {
      data: {
        display_name: "Anurag Sharma",
        college_name: "AIIMS New Delhi",
      },
      error: null,
    });

    const res = await verifyRoute(post("/api/public/verify", { body: { code: PASS_CODE } }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);

    expect(body.data.isReal).toBe(true);
    expect(body.data.valid).toBe(true);
    expect(body.data.status).toBe("ACTIVE");
    expect(body.data.passCode).toBe(PASS_CODE);
    expect(body.data.productName).toBe("VIP All-Access Delegate Pass");
    expect(body.data.purchasedAt).toBe("2026-08-20T10:00:00.000Z");
    expect(body.data.maskedName).toBe("A***** S*****");
  });

  it("verifies an expired pass and reports status as EXPIRED", async () => {
    sb.onTable("delegate_passes", {
      data: [
        {
          id: "pass-exp",
          public_pass_code: "PP-EXPIRED123",
          state: "ACTIVE",
          activated_at: "2025-01-01T10:00:00.000Z",
          created_at: "2025-01-01T10:00:00.000Z",
          expires_at: "2025-02-01T00:00:00.000Z",
          user_id: USER_ID,
          pass_products: {
            name: "Basic Festival Card",
            slug: "basic-card",
            is_base_pass: true,
          },
        },
      ],
      error: null,
    });

    sb.onTable("profiles", {
      data: { display_name: "Rohan Verma", college_name: "MAMC" },
      error: null,
    });

    const res = await verifyRoute(post("/api/public/verify", { body: { code: "PP-EXPIRED123" } }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);

    expect(body.data.isReal).toBe(true);
    expect(body.data.valid).toBe(false);
    expect(body.data.status).toBe("EXPIRED");
  });

  it("identifies a fake or unrecognized pass", async () => {
    sb.onTable("delegate_passes", { data: [], error: null });
    sb.onTable("registrations", { data: [], error: null });
    sb.onTable("orders", { data: [], error: null });

    const res = await verifyRoute(post("/api/public/verify", { body: { code: "FAKE-PASS-999" } }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);

    expect(body.data.isReal).toBe(false);
    expect(body.data.valid).toBe(false);
    expect(body.data.status).toBe("FAKE_OR_UNRECOGNIZED");
  });

  it("normalizes lowercase and un-prefixed pass inputs", async () => {
    sb.onTable("delegate_passes", {
      data: [
        {
          id: "pass-2",
          public_pass_code: "PP-ABC123DEF456",
          state: "ACTIVE",
          activated_at: "2026-08-21T12:00:00.000Z",
          created_at: "2026-08-21T12:00:00.000Z",
          expires_at: FUTURE_EXPIRY,
          user_id: USER_ID,
          pass_products: {
            name: "Basic Festival Card",
            slug: "basic-card",
            is_base_pass: true,
          },
        },
      ],
      error: null,
    });

    sb.onTable("profiles", {
      data: { display_name: "Priya Patel", college_name: "LHMC" },
      error: null,
    });

    const res = await verifyRoute(post("/api/public/verify", { body: { code: "pp-abc123def456" } }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);

    expect(body.data.isReal).toBe(true);
    expect(body.data.valid).toBe(true);
    expect(body.data.passCode).toBe("PP-ABC123DEF456");
  });

  it("never labels a code counterfeit when the lookup itself fails", async () => {
    sb.onTable("delegate_passes", { data: null, error: { message: "connection terminated" } });
    const res = await verifyRoute(post("/api/public/verify", { body: { code: PASS_CODE } }));
    expect(res.status).toBe(502);
    expectErrEnvelope(await json(res), "UPSTREAM_ERROR");
  });

  it("names an event registration by the event's name column", async () => {
    sb.onTable("delegate_passes", { data: [], error: null });
    sb.onTable("registrations", {
      data: [
        {
          id: "reg-1",
          public_registration_code: "PR-ABC123",
          state: "CONFIRMED",
          confirmed_at: "2026-09-01T10:00:00.000Z",
          created_at: "2026-09-01T10:00:00.000Z",
          owner_user_id: null,
          team_name: null,
          events: { id: "ev-1", name: "Battle of Bands", starts_at: null, ends_at: null },
        },
      ],
      error: null,
    });
    const res = await verifyRoute(post("/api/public/verify", { body: { code: "PR-ABC123" } }));
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.isReal).toBe(true);
    expect(body.data.productName).toBe("Battle of Bands");
  });
});
