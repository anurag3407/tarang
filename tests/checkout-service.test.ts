import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockSupabase, fail, ok } from "./helpers/supabase-mock";

const sb = new MockSupabase();

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => sb,
}));

const rzpMock = {
  orders: { create: vi.fn() },
  payments: { fetch: vi.fn() },
};
vi.mock("@/lib/razorpay/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/razorpay/client")>();
  return {
    ...actual,
    getRazorpay: () => rzpMock,
  };
});

import {
  createBasePassCheckout,
  createEventCheckout,
  newIdempotencyKey,
} from "@/services/checkout-service";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const FEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PRODUCT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EVENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const RZP_ORDER_ID = "order_RZP_NEW";

beforeEach(() => {
  sb.calls = [];
  vi.clearAllMocks();
});

describe("createBasePassCheckout (plan §9.2, §12.3)", () => {
  it("creates an order, provisions Razorpay with the server-side amount, never a browser amount", async () => {
    sb.onRpc("create_base_pass_checkout", ok({ orderId: ORDER_ID, replayed: false }));
    sb.onTable("orders", ok({ amount_paise: "20000", currency: "INR" })); // amount read
    rzpMock.orders.create.mockResolvedValueOnce({ id: RZP_ORDER_ID, status: "created" });
    sb.onRpc("attach_razorpay_order", ok({}));
    // getOrderResult
    sb.onTable("orders", ok({
      id: ORDER_ID,
      public_order_code: "PO-ABC123",
      checkout_state: "AWAITING_PAYMENT",
      amount_paise: "20000",
      currency: "INR",
      hold_expires_at: null,
    }));
    sb.onTable("razorpay_orders", ok({ razorpay_order_id: RZP_ORDER_ID }));

    const result = await createBasePassCheckout(USER_ID, FEST_ID, PRODUCT_ID, newIdempotencyKey());

    expect(result.amountPaise).toBe(20000);
    expect(result.razorpayOrderId).toBe(RZP_ORDER_ID);

    // The amount sent to Razorpay comes from the DB snapshot, not the client.
    expect(rzpMock.orders.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 20000, currency: "INR" })
    );
    const attach = sb.rpcParams("attach_razorpay_order");
    expect(attach?.p_amount_paise).toBe(20000);
  });

  it("fulfills a zero-price pass WITHOUT calling Razorpay (regression: amount-0 orders are rejected by the provider)", async () => {
    sb.onRpc("create_base_pass_checkout", ok({ orderId: ORDER_ID, replayed: false }));
    sb.onTable("orders", ok({ amount_paise: "0", currency: "INR" })); // amount read
    // fulfillFreeOrder: order read, attach synthetic, apply
    sb.onTable("orders", ok({ amount_paise: "0", currency: "INR" }));
    sb.onRpc("attach_razorpay_order", ok({}));
    sb.onRpc("apply_captured_payment", ok({ result: "FULFILLED" }));
    // getOrderResult
    sb.onTable("orders", ok({
      id: ORDER_ID,
      public_order_code: "PO-FREE01",
      checkout_state: "FULFILLED",
      amount_paise: "0",
      currency: "INR",
      hold_expires_at: null,
    }));
    sb.onTable("razorpay_orders", ok({ razorpay_order_id: `free_${ORDER_ID.replace(/-/g, "")}` }));

    const result = await createBasePassCheckout(USER_ID, FEST_ID, PRODUCT_ID, newIdempotencyKey());

    expect(rzpMock.orders.create).not.toHaveBeenCalled();
    expect(result.status).toBe("FULFILLED");
    const apply = sb.rpcParams("apply_captured_payment");
    expect(apply?.p_provider_status).toBe("captured");
  });

  it("replays the original order for a repeated idempotency key without re-provisioning", async () => {
    sb.onRpc("create_base_pass_checkout", ok({ orderId: ORDER_ID, replayed: true }));
    sb.onTable("orders", ok({
      id: ORDER_ID,
      public_order_code: "PO-ABC123",
      checkout_state: "AWAITING_PAYMENT",
      amount_paise: "20000",
      currency: "INR",
      hold_expires_at: null,
    }));
    sb.onTable("razorpay_orders", ok({ razorpay_order_id: RZP_ORDER_ID }));

    const key = newIdempotencyKey();
    const result = await createBasePassCheckout(USER_ID, FEST_ID, PRODUCT_ID, key);

    expect(result.localOrderId).toBe(ORDER_ID);
    expect(rzpMock.orders.create).not.toHaveBeenCalled();
  });

  it("retries provisioning on replay when the first attempt never attached a Razorpay order", async () => {
    sb.onRpc("create_base_pass_checkout", ok({ orderId: ORDER_ID, replayed: true }));
    const provisioning = {
      id: ORDER_ID,
      public_order_code: "PO-ABC123",
      checkout_state: "PROVISIONING_PROVIDER",
      amount_paise: "20000",
      currency: "INR",
      hold_expires_at: null,
    };
    sb.onTable("orders", ok(provisioning));
    sb.onTable("razorpay_orders", ok(null));
    rzpMock.orders.create.mockResolvedValueOnce({ id: RZP_ORDER_ID, status: "created" });
    sb.onRpc("attach_razorpay_order", ok({}));
    sb.onTable("orders", ok({ ...provisioning, checkout_state: "AWAITING_PAYMENT" }));
    sb.onTable("razorpay_orders", ok({ razorpay_order_id: RZP_ORDER_ID }));

    const result = await createBasePassCheckout(USER_ID, FEST_ID, PRODUCT_ID, newIdempotencyKey());

    expect(rzpMock.orders.create).toHaveBeenCalledTimes(1);
    expect(rzpMock.orders.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 20000 }));
    expect(result.razorpayOrderId).toBe(RZP_ORDER_ID);
    expect(result.status).toBe("AWAITING_PAYMENT");
  });

  it("maps SOLD_OUT-style RPC errors to typed AppErrors", async () => {
    sb.onRpc("create_base_pass_checkout", fail("BASE_PASS_EXISTS: duplicate"));
    await expect(
      createBasePassCheckout(USER_ID, FEST_ID, PRODUCT_ID, newIdempotencyKey())
    ).rejects.toMatchObject({ code: "BASE_PASS_EXISTS" });
  });

  it("maps the new BASE_PASS_ORDER_OPEN error to a friendly retry message", async () => {
    sb.onRpc("create_base_pass_checkout", fail("BASE_PASS_ORDER_OPEN"));
    await expect(
      createBasePassCheckout(USER_ID, FEST_ID, PRODUCT_ID, newIdempotencyKey())
    ).rejects.toMatchObject({ code: "BASE_PASS_EXISTS" });
  });

  it("releases the local hold when the provider definitively rejects the order (4xx)", async () => {
    sb.onRpc("create_base_pass_checkout", ok({ orderId: ORDER_ID, replayed: false }));
    sb.onTable("orders", ok({ amount_paise: "20000", currency: "INR" }));
    rzpMock.orders.create.mockRejectedValueOnce(
      Object.assign(new Error("bad request"), { statusCode: 400 })
    );
    // releaseLocalOrder: line lookup, hold update, expire_holds_batch, order cancel
    sb.onTable("order_lines", ok({ id: "line-1" }));
    sb.onTable("capacity_holds", ok(null));
    sb.onRpc("expire_holds_batch", ok({ expired: 0, inventory: [] }));
    sb.onTable("orders", ok(null));

    await expect(
      createBasePassCheckout(USER_ID, FEST_ID, PRODUCT_ID, newIdempotencyKey())
    ).rejects.toMatchObject({ code: "UPSTREAM_ERROR" });

    expect(sb.rpcParams("expire_holds_batch")).toBeDefined();
  });

  it("keeps the order in provisioning on uncertain provider failure (5xx/network)", async () => {
    sb.onRpc("create_base_pass_checkout", ok({ orderId: ORDER_ID, replayed: false }));
    sb.onTable("orders", ok({ amount_paise: "20000", currency: "INR" }));
    rzpMock.orders.create.mockRejectedValueOnce(new Error("ECONNRESET"));
    sb.onTable("orders", ok({
      id: ORDER_ID,
      public_order_code: "PO-ABC123",
      checkout_state: "PROVISIONING_PROVIDER",
      amount_paise: "20000",
      currency: "INR",
      hold_expires_at: null,
    }));
    sb.onTable("razorpay_orders", ok(null));

    const result = await createBasePassCheckout(USER_ID, FEST_ID, PRODUCT_ID, newIdempotencyKey());
    // No release happened; reconciler will resolve it.
    expect(result.status).toBe("PROVISIONING_PROVIDER");
    expect(sb.callsFor("expire_holds_batch").length).toBe(0);
  });
});

describe("createEventCheckout (plan §9.3, §12.5)", () => {
  it("reserves inventory server-side and returns the snapshot amount", async () => {
    sb.onRpc(
      "create_event_checkout",
      ok({ orderId: ORDER_ID, replayed: false, amountPaise: 15000 })
    );
    rzpMock.orders.create.mockResolvedValueOnce({ id: RZP_ORDER_ID, status: "created" });
    sb.onRpc("attach_razorpay_order", ok({}));
    sb.onTable("orders", ok({
      id: ORDER_ID,
      public_order_code: "PO-EVT01",
      checkout_state: "AWAITING_PAYMENT",
      amount_paise: "15000",
      currency: "INR",
      hold_expires_at: "2026-08-22T10:10:00Z",
    }));
    sb.onTable("razorpay_orders", ok({ razorpay_order_id: RZP_ORDER_ID }));

    const result = await createEventCheckout(
      USER_ID,
      FEST_ID,
      EVENT_ID,
      "INDIVIDUAL",
      null,
      newIdempotencyKey()
    );

    expect(result.amountPaise).toBe(15000);
    const rpc = sb.rpcParams("create_event_checkout");
    expect(rpc?.p_event_id).toBe(EVENT_ID);
    expect(rpc?.p_team_draft_id).toBeNull();
  });

  it("fulfills zero-price events without Razorpay", async () => {
    sb.onRpc(
      "create_event_checkout",
      ok({ orderId: ORDER_ID, replayed: false, amountPaise: 0 })
    );
    sb.onTable("orders", ok({ amount_paise: "0", currency: "INR" }));
    sb.onRpc("attach_razorpay_order", ok({}));
    sb.onRpc("apply_captured_payment", ok({ result: "FULFILLED" }));
    sb.onTable("orders", ok({
      id: ORDER_ID,
      public_order_code: "PO-EVTFREE",
      checkout_state: "FULFILLED",
      amount_paise: "0",
      currency: "INR",
      hold_expires_at: null,
    }));
    sb.onTable("razorpay_orders", ok({ razorpay_order_id: `free_${ORDER_ID.replace(/-/g, "")}` }));

    const result = await createEventCheckout(
      USER_ID,
      FEST_ID,
      EVENT_ID,
      "INDIVIDUAL",
      null,
      newIdempotencyKey()
    );

    expect(rzpMock.orders.create).not.toHaveBeenCalled();
    expect(result.status).toBe("FULFILLED");
  });

  it("surfaces SOLD_OUT from the inventory guard", async () => {
    sb.onRpc("create_event_checkout", fail("SOLD_OUT"));
    await expect(
      createEventCheckout(USER_ID, FEST_ID, EVENT_ID, "INDIVIDUAL", null, newIdempotencyKey())
    ).rejects.toMatchObject({ code: "SOLD_OUT" });
  });

  it("surfaces BASE_PASS_REQUIRED for participants without a delegate pass", async () => {
    sb.onRpc("create_event_checkout", fail("BASE_PASS_REQUIRED"));
    await expect(
      createEventCheckout(USER_ID, FEST_ID, EVENT_ID, "INDIVIDUAL", null, newIdempotencyKey())
    ).rejects.toMatchObject({ code: "BASE_PASS_REQUIRED" });
  });

  it("surfaces IDEMPOTENCY_MISMATCH when a key is reused with a different request", async () => {
    sb.onRpc("create_event_checkout", fail("IDEMPOTENCY_MISMATCH"));
    await expect(
      createEventCheckout(USER_ID, FEST_ID, EVENT_ID, "INDIVIDUAL", null, newIdempotencyKey())
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
  });
});
