import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  FESTIVAL_ID,
  ORDER_ID,
  PRODUCT_ID,
  USER_ID,
  rateLimiter,
  resetWorld,
  rzp,
  sb,
  userSb,
} from "./helpers/mocks";
import { ctx, del, get, json, post, expectOkEnvelope, expectErrEnvelope } from "./helpers/requests";

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
vi.mock("@/lib/razorpay/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/razorpay/client")>();
  const m = await import("./helpers/mocks");
  return { ...actual, getRazorpay: () => m.rzp };
});

import { POST as basePassCheckout } from "@/app/api/checkout/base-pass/route";
import { POST as discountPreview } from "@/app/api/checkout/discount-preview/route";
import { GET as adminListCodes, POST as adminCreateCode } from "@/app/api/admin/discount-codes/route";
import { PATCH as adminPatchCode, DELETE as adminDeleteCode } from "@/app/api/admin/discount-codes/[id]/route";

const RZP_ORDER = "order_RZP_DISC";
const CODE_ID = "c0dec0de-c0de-4c0d-8c0d-c0dec0dec0de";
const KEY_HEADER = { "idempotency-key": randomUUID() };

function codeRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: CODE_ID,
    code: "TARANG100",
    description: "",
    discount_type: "FLAT",
    amount_off_paise: "10000",
    percent_off: null,
    pass_product_id: null,
    max_redemptions: 50,
    per_user_limit: 1,
    valid_from: null,
    valid_until: null,
    is_active: true,
    version: 1,
    created_at: "2026-10-13T10:00:00Z",
    updated_at: "2026-10-13T10:00:00Z",
    ...overrides,
  };
}

/** Maintenance + sales flags consumed by the checkout routes. */
function seedFlags(withSales = true): void {
  sb.onTable("feature_flags", { data: { enabled: false }, error: null });
  if (withSales) sb.onTable("feature_flags", { data: { enabled: true }, error: null });
}

function grantAdmin(permission = true): void {
  sb.onTable("festivals", { data: { id: FESTIVAL_ID }, error: null });
  userSb.setActor({ id: ADMIN_ID, email: "admin@example.com", confirmed: true });
  userSb.onRpc("has_permission", { data: permission, error: null });
}

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld({ actor: { id: USER_ID, email: "student@example.com", confirmed: true } });
});

describe("POST /api/checkout/base-pass with a discount code", () => {
  it("passes the normalized code to the RPC, binds it into the request hash, and charges the server amount", async () => {
    seedFlags();
    sb.onRpc("create_base_pass_checkout", { data: { orderId: ORDER_ID, replayed: false }, error: null });
    sb.onTable("orders", { data: { amount_paise: "10000", currency: "INR" }, error: null });
    rzp.orders.create.mockResolvedValueOnce({ id: RZP_ORDER, status: "created" });
    sb.onRpc("attach_razorpay_order", { data: {}, error: null });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        public_order_code: "PO-DISC01",
        checkout_state: "AWAITING_PAYMENT",
        amount_paise: "10000",
        currency: "INR",
        hold_expires_at: null,
        discount_paise: "10000",
        discount_code_snapshot: "TARANG100",
      },
      error: null,
    });
    sb.onTable("razorpay_orders", { data: { razorpay_order_id: RZP_ORDER }, error: null });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", {
        body: { passProductId: PRODUCT_ID, discountCode: "  tarang100 " },
        headers: KEY_HEADER,
      })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data).toMatchObject({ amountPaise: 10000, discountPaise: 10000, discountCode: "TARANG100" });

    const rpc = sb.rpcParams("create_base_pass_checkout");
    expect(rpc?.p_discount_code).toBe("TARANG100");
    expect(rpc?.p_request_hash).toBe(
      createHash("sha256")
        .update(JSON.stringify({ passProductId: PRODUCT_ID, discountCode: "TARANG100" }))
        .digest("hex")
    );
    expect(rzp.orders.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 10000 }));
    // Code attempts draw on the discount budget, not only the order budget.
    expect(rateLimiter.calls.some((c) => c.cls === "discount" && c.identifier === `user:${USER_ID}`)).toBe(true);
  });

  it("sends no code and keeps the original request hash when none is given", async () => {
    seedFlags();
    sb.onRpc("create_base_pass_checkout", { data: { orderId: ORDER_ID, replayed: true }, error: null });
    sb.onTable("orders", {
      data: { id: ORDER_ID, public_order_code: "PO-1", checkout_state: "AWAITING_PAYMENT", amount_paise: "20000", currency: "INR", hold_expires_at: null },
      error: null,
    });
    sb.onTable("razorpay_orders", { data: { razorpay_order_id: RZP_ORDER }, error: null });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(201);
    const rpc = sb.rpcParams("create_base_pass_checkout");
    expect(rpc?.p_discount_code).toBeNull();
    expect(rpc?.p_request_hash).toBe(
      createHash("sha256").update(JSON.stringify({ passProductId: PRODUCT_ID })).digest("hex")
    );
    expect(rateLimiter.calls.some((c) => c.cls === "discount")).toBe(false);
  });

  it.each([
    ["DISCOUNT_EXHAUSTED", "usage limit"],
    ["DISCOUNT_ALREADY_USED", "already used"],
    ["DISCOUNT_INVALID", "invalid or has expired"],
  ])("maps %s to a 422 DISCOUNT_INVALID", async (sqlError, text) => {
    seedFlags();
    sb.onRpc("create_base_pass_checkout", { data: null, error: { message: sqlError } });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", {
        body: { passProductId: PRODUCT_ID, discountCode: "TARANG100" },
        headers: KEY_HEADER,
      })
    );
    expect(res.status).toBe(422);
    const body = await json(res);
    expectErrEnvelope(body, "DISCOUNT_INVALID");
    expect(body.message).toContain(text);
    expect(rzp.orders.create).not.toHaveBeenCalled();
  });

  it("rejects a malformed code and any smuggled amount before touching the DB", async () => {
    for (const extra of [{ discountCode: "no spaces!" }, { discountCode: "TARANG100", discountPaise: 20000 }]) {
      resetWorld();
      seedFlags();
      const res = await basePassCheckout(
        post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID, ...extra }, headers: KEY_HEADER })
      );
      expect(res.status).toBe(422);
      expect(sb.rpcParams("create_base_pass_checkout")).toBeUndefined();
    }
  });

  it("fails closed when the discount limiter is unavailable", async () => {
    seedFlags();
    rateLimiter.reset("unavailable");
    const res = await basePassCheckout(
      post("/api/checkout/base-pass", {
        body: { passProductId: PRODUCT_ID, discountCode: "TARANG100" },
        headers: KEY_HEADER,
      })
    );
    expect(res.status).toBe(503);
    expect(sb.rpcParams("create_base_pass_checkout")).toBeUndefined();
  });
});

describe("POST /api/checkout/discount-preview", () => {
  it("returns the server quote", async () => {
    sb.onTable("feature_flags", { data: { enabled: false }, error: null });
    sb.onRpc("preview_pass_discount", {
      data: { code: "TARANG100", originalAmountPaise: "20000", discountPaise: "10000", finalAmountPaise: "10000" },
      error: null,
    });

    const res = await discountPreview(
      post("/api/checkout/discount-preview", { body: { passProductId: PRODUCT_ID, code: "tarang100" } })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data).toEqual({
      code: "TARANG100",
      originalAmountPaise: 20000,
      discountPaise: 10000,
      finalAmountPaise: 10000,
    });
    expect(sb.rpcParams("preview_pass_discount")).toMatchObject({ p_user_id: USER_ID, p_code: "TARANG100" });
    expect(rateLimiter.calls.filter((c) => c.cls === "discount").length).toBeGreaterThanOrEqual(1);
  });

  it("requires a signed-in user", async () => {
    resetWorld({ actor: null });
    const res = await discountPreview(
      post("/api/checkout/discount-preview", { body: { passProductId: PRODUCT_ID, code: "TARANG100" } })
    );
    expect(res.status).toBe(401);
    expect(sb.rpcParams("preview_pass_discount")).toBeUndefined();
  });

  it("is rate limited before the code is looked up", async () => {
    sb.onTable("feature_flags", { data: { enabled: false }, error: null });
    rateLimiter.reset("limited");
    const res = await discountPreview(
      post("/api/checkout/discount-preview", { body: { passProductId: PRODUCT_ID, code: "TARANG100" } })
    );
    expect(res.status).toBe(429);
    expect(sb.rpcParams("preview_pass_discount")).toBeUndefined();
  });

  it("gives unknown codes the same answer as malformed ones", async () => {
    sb.onTable("feature_flags", { data: { enabled: false }, error: null });
    sb.onRpc("preview_pass_discount", { data: null, error: { message: "DISCOUNT_INVALID" } });
    const unknown = await json(
      await discountPreview(post("/api/checkout/discount-preview", { body: { passProductId: PRODUCT_ID, code: "NOPE1234" } }))
    );

    resetWorld();
    sb.onTable("feature_flags", { data: { enabled: false }, error: null });
    const malformed = await json(
      await discountPreview(post("/api/checkout/discount-preview", { body: { passProductId: PRODUCT_ID, code: "x" } }))
    );

    expectErrEnvelope(unknown, "DISCOUNT_INVALID");
    expectErrEnvelope(malformed, "DISCOUNT_INVALID");
    expect(unknown.message).toBe(malformed.message);
  });
});

describe("/api/admin/discount-codes (superadmin)", () => {
  it("403s without discount.manage and never reads codes", async () => {
    grantAdmin(false);
    const res = await adminListCodes(get("/api/admin/discount-codes"));
    expect(res.status).toBe(403);
    expect(sb.callsFor("discount_codes")).toHaveLength(0);
    expect(userSb.rpcParams("has_permission")?.p_permission).toBe("discount.manage");
  });

  it("lists codes with usage", async () => {
    grantAdmin();
    sb.onTable("discount_codes", { data: [codeRow()], error: null });
    sb.onTable("pass_products", {
      data: [{ id: PRODUCT_ID, name: "Pronite Pass", status: "PUBLISHED", sales_state: "OPEN" }],
      error: null,
    });
    sb.onRpc("discount_code_usage", {
      data: [{ discount_code_id: CODE_ID, fulfilled_count: "3", pending_count: "1", fulfilled_discount_paise: "30000" }],
      error: null,
    });

    const res = await adminListCodes(get("/api/admin/discount-codes"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.codes[0]).toMatchObject({
      code: "TARANG100",
      amountOffPaise: 10000,
      usage: { fulfilledCount: 3, pendingCount: 1, fulfilledDiscountPaise: 30000 },
    });
    expect(body.data.passProducts[0]).toEqual({ id: PRODUCT_ID, name: "Pronite Pass", onSale: true });
  });

  it("creates a code scoped to the festival, converting rupees to paise, and audits it", async () => {
    grantAdmin();
    sb.onTable("pass_products", { data: { id: PRODUCT_ID }, error: null });
    sb.onTable("discount_codes", { data: codeRow({ amount_off_paise: "15050", pass_product_id: PRODUCT_ID }), error: null });
    userSb.onRpc("write_audit", { data: null, error: null });

    const res = await adminCreateCode(
      post("/api/admin/discount-codes", {
        body: {
          code: "tarang100",
          discountType: "FLAT",
          amountOffRupees: 150.5,
          passProductId: PRODUCT_ID,
          maxRedemptions: 50,
        },
      })
    );
    expect(res.status).toBe(201);
    const insert = sb.callsFor("discount_codes").find((c) => c.action === "insert");
    expect(insert?.payload).toMatchObject({
      festival_id: FESTIVAL_ID,
      code: "TARANG100",
      amount_off_paise: 15050,
      percent_off: null,
      created_by: ADMIN_ID,
    });
    expect(userSb.rpcParams("write_audit")?.p_action).toBe("discount_code.create");
  });

  it.each([
    [{ code: "TARANG100", discountType: "FLAT", percentOff: 10 }],
    [{ code: "TARANG100", discountType: "PERCENT", percentOff: 101 }],
    [{ code: "TARANG100", discountType: "FLAT", amountOffRupees: 10.001 }],
    [{ code: "TARANG100", discountType: "FLAT", amountOffRupees: 10, festivalId: FESTIVAL_ID }],
    [{ code: "TARANG100", discountType: "FLAT", amountOffRupees: 10, validFrom: "2026-10-20T00:00:00Z", validUntil: "2026-10-19T00:00:00Z" }],
  ])("rejects invalid create payload %j", async (payload) => {
    grantAdmin();
    const res = await adminCreateCode(post("/api/admin/discount-codes", { body: payload }));
    expect(res.status).toBe(422);
    expect(sb.callsFor("discount_codes")).toHaveLength(0);
  });

  it("409s on a duplicate code", async () => {
    grantAdmin();
    sb.onTable("discount_codes", { data: null, error: { message: "duplicate key", code: "23505" } });
    const res = await adminCreateCode(
      post("/api/admin/discount-codes", { body: { code: "TARANG100", discountType: "PERCENT", percentOff: 10 } })
    );
    expect(res.status).toBe(409);
  });

  it("refuses to create codes from a foreign origin", async () => {
    grantAdmin();
    const res = await adminCreateCode(
      post("/api/admin/discount-codes", {
        body: { code: "TARANG100", discountType: "PERCENT", percentOff: 10 },
        origin: "https://evil.example",
      })
    );
    expect(res.status).toBe(400);
    expect(sb.callsFor("discount_codes")).toHaveLength(0);
  });

  it("PATCH applies an optimistic version check", async () => {
    grantAdmin();
    sb.onTable("discount_codes", { data: codeRow({ version: 2 }), error: null }); // before
    sb.onTable("discount_codes", { data: null, error: null }); // update matched no row

    const res = await adminPatchCode(
      post(`/api/admin/discount-codes/${CODE_ID}`, { body: { isActive: false, version: 1 } }),
      ctx({ id: CODE_ID }) as never
    );
    expect(res.status).toBe(409);
    const update = sb.callsFor("discount_codes").find((c) => c.action === "update");
    expect(update?.filters).toMatchObject({ id: CODE_ID, festival_id: FESTIVAL_ID, version: 1 });
  });

  it("PATCH cannot change the code or its value", async () => {
    grantAdmin();
    const res = await adminPatchCode(
      post(`/api/admin/discount-codes/${CODE_ID}`, { body: { amountOffRupees: 1000, version: 1 } }),
      ctx({ id: CODE_ID }) as never
    );
    expect(res.status).toBe(422);
  });

  it("DELETE refuses a code that orders reference", async () => {
    grantAdmin();
    sb.onTable("discount_codes", { data: null, error: { message: "fk violation", code: "23503" } });
    const res = await adminDeleteCode(del(`/api/admin/discount-codes/${CODE_ID}`), ctx({ id: CODE_ID }) as never);
    expect(res.status).toBe(409);
    const body = await json(res);
    expectErrEnvelope(body, "CONFLICT");
    expect(body.message).toContain("deactivate");
  });
});
