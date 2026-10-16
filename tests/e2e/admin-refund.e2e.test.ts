import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ID, FESTIVAL_ID, resetWorld, sb, userSb } from "./helpers/mocks";
import { ctx, json, post, expectOkEnvelope, expectErrEnvelope } from "./helpers/requests";

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

import { POST as refundOrderRoute } from "@/app/api/admin/orders/[id]/refund/route";

const ORDER_ID = "01de7001-01de-401d-801d-01de700101de";

describe("POST /api/admin/orders/[id]/refund", () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.advanceTimersByTime(31_000);
    resetWorld({ actor: { id: ADMIN_ID, email: "admin@example.com", confirmed: true } });
    userSb.setActor({ id: ADMIN_ID, email: "admin@example.com", confirmed: true });
    sb.onTable("festivals", { data: { id: FESTIVAL_ID, slug: "tarang-2026", status: "PUBLISHED" }, error: null });
    userSb.onTable("festivals", {
      data: [{ id: FESTIVAL_ID, slug: "tarang-2026", status: "PUBLISHED" }],
      error: null,
    });
  });

  it("marks an order and associated passes as REFUNDED", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        public_order_code: "PO-REF01",
        festival_id: FESTIVAL_ID,
      },
      error: null,
    });
    sb.onRpc("refund_order", {
      data: {
        refunded: true,
        orderId: ORDER_ID,
        publicOrderCode: "PO-REF01",
        passesRefunded: 1,
        registrationsRefunded: 0,
      },
      error: null,
    });

    const res = await refundOrderRoute(
      post(`/api/admin/orders/${ORDER_ID}/refund`, { body: { reason: "Customer requested cancellation" } }),
      ctx({ id: ORDER_ID })
    );

    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.refunded).toBe(true);
    expect(body.data.publicOrderCode).toBe("PO-REF01");
  });

  it("rejects non-admin requests with FORBIDDEN", async () => {
    userSb.onRpc("has_permission", { data: false, error: null });
    const res = await refundOrderRoute(
      post(`/api/admin/orders/${ORDER_ID}/refund`, { body: {} }),
      ctx({ id: ORDER_ID })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });

  it("returns 404 if order does not exist", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("orders", {
      data: null,
      error: null,
    });
    const res = await refundOrderRoute(
      post(`/api/admin/orders/${ORDER_ID}/refund`, { body: {} }),
      ctx({ id: ORDER_ID })
    );
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });

  it("checks the dedicated refund.approve permission", async () => {
    userSb.onRpc("has_permission", { data: false, error: null });
    await refundOrderRoute(post(`/api/admin/orders/${ORDER_ID}/refund`, { body: {} }), ctx({ id: ORDER_ID }));
    expect(userSb.rpcParams("has_permission")).toMatchObject({ p_permission: "refund.approve" });
  });

  it("does not touch another festival's order", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("orders", {
      data: { id: ORDER_ID, public_order_code: "PO-REF01", festival_id: "99999999-9999-4999-8999-999999999999" },
      error: null,
    });
    const res = await refundOrderRoute(post(`/api/admin/orders/${ORDER_ID}/refund`, { body: {} }), ctx({ id: ORDER_ID }));
    expect(res.status).toBe(404);
    expect(sb.callsFor("refund_order")).toEqual([]);
  });

  it("returns 404 for a malformed order id without querying", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    const res = await refundOrderRoute(post(`/api/admin/orders/not-a-uuid/refund`, { body: {} }), ctx({ id: "not-a-uuid" }));
    expect(res.status).toBe(404);
    expect(sb.callsFor("refund_order")).toEqual([]);
  });

  it("surfaces NOT_REFUNDABLE as a conflict and never falls back to direct writes", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("orders", {
      data: { id: ORDER_ID, public_order_code: "PO-REF01", festival_id: FESTIVAL_ID },
      error: null,
    });
    sb.onRpc("refund_order", { data: null, error: { message: "NOT_REFUNDABLE" } });
    const res = await refundOrderRoute(post(`/api/admin/orders/${ORDER_ID}/refund`, { body: {} }), ctx({ id: ORDER_ID }));
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "CONFLICT");
    const writes = sb.calls.filter((c) => ["update", "insert", "upsert"].includes(c.action));
    expect(writes).toEqual([]);
  });

  it("fails loudly when the refund function errors", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("orders", {
      data: { id: ORDER_ID, public_order_code: "PO-REF01", festival_id: FESTIVAL_ID },
      error: null,
    });
    sb.onRpc("refund_order", { data: null, error: { message: "deadlock detected" } });
    const res = await refundOrderRoute(post(`/api/admin/orders/${ORDER_ID}/refund`, { body: {} }), ctx({ id: ORDER_ID }));
    expect(res.status).toBe(500);
    expect(sb.calls.filter((c) => c.action === "update")).toEqual([]);
  });
});
