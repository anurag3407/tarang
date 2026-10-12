import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVENT_ID,
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
vi.mock("@/lib/razorpay/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/razorpay/client")>();
  const m = await import("./helpers/mocks");
  return { ...actual, getRazorpay: () => m.rzp };
});

import { POST as basePassCheckout } from "@/app/api/checkout/base-pass/route";
import { POST as eventCheckout } from "@/app/api/checkout/events/[eventId]/route";
import { GET as orderStatus } from "@/app/api/checkout/orders/[orderId]/route";
import { POST as cancelOrderRoute } from "@/app/api/checkout/orders/[orderId]/cancel/route";

const RZP_ORDER = "order_RZP_E2E";
const KEY_HEADER = { "idempotency-key": randomUUID() };

/** Auth + flag prelude every authenticated mutation consumes. */
function seedGuards(opts: { maintenance?: boolean; sales?: boolean; salesRow?: boolean } = {}): void {
  if (opts.salesRow === false) {
    // Flag row entirely missing -> getFeatureFlag fails closed.
    sb.onTable("feature_flags", { data: null, error: null }); // maintenance (fail open)
    return;
  }
  sb.onTable("feature_flags", {
    data: { enabled: opts.maintenance ?? false },
    error: null,
  });
  sb.onTable("feature_flags", {
    data: { enabled: opts.sales ?? true },
    error: null,
  });
}

function seedPaidBasePassJourney(): void {
  seedGuards();
  sb.onRpc("create_base_pass_checkout", {
    data: { orderId: ORDER_ID, replayed: false },
    error: null,
  });
  sb.onTable("orders", { data: { amount_paise: "20000", currency: "INR" }, error: null });
  rzp.orders.create.mockResolvedValueOnce({ id: RZP_ORDER, status: "created" });
  sb.onRpc("attach_razorpay_order", { data: {}, error: null });
  sb.onTable("orders", {
    data: {
      id: ORDER_ID,
      public_order_code: "PO-E2E001",
      checkout_state: "AWAITING_PAYMENT",
      amount_paise: "20000",
      currency: "INR",
      hold_expires_at: "2026-08-22T10:10:00Z",
    },
    error: null,
  });
  sb.onTable("razorpay_orders", { data: { razorpay_order_id: RZP_ORDER }, error: null });
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

describe("POST /api/checkout/base-pass — happy path (plan §12.3)", () => {
  it("creates the order, provisions Razorpay with the DB-snapshotted amount", async () => {
    seedPaidBasePassJourney();

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", {
        body: { passProductId: PRODUCT_ID },
        headers: KEY_HEADER,
      })
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data).toMatchObject({
      localOrderId: ORDER_ID,
      publicOrderCode: "PO-E2E001",
      razorpayOrderId: RZP_ORDER,
      razorpayKeyId: "rzp_test_key",
      amountPaise: 20000,
      currency: "INR",
      status: "AWAITING_PAYMENT",
    });

    const rpc = sb.rpcParams("create_base_pass_checkout");
    expect(rpc?.p_user_id).toBe(USER_ID);
    expect(rpc?.p_festival_id).toBe(FESTIVAL_ID);
    expect(rpc?.p_pass_product_id).toBe(PRODUCT_ID);
    expect(rpc?.p_request_hash).toBe(
      createHash("sha256").update(JSON.stringify({ passProductId: PRODUCT_ID })).digest("hex")
    );

    // Amount comes from the server snapshot, never from the browser.
    expect(rzp.orders.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 20000,
        currency: "INR",
        notes: { local_order_id: ORDER_ID },
        payment: { capture: "automatic" },
      })
    );
    expect(sb.rpcParams("attach_razorpay_order")?.p_amount_paise).toBe(20000);
    // Every queued response was consumed — no drift between app and script.
    expect(sb.pendingCount()).toBe(0);
    expect(userSb.pendingCount()).toBe(0);
  });
});

describe("base-pass checkout — request hardening", () => {
  it("401s an anonymous caller before any database work", async () => {
    resetWorld({ actor: null });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(401);
    const body = await json(res);
    expectErrEnvelope(body, "UNAUTHORIZED");
    expect(sb.calls.length).toBe(0);
  });

  it("401s a session whose email is not confirmed", async () => {
    resetWorld({ actor: { id: USER_ID, email: "student@example.com", confirmed: false } });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(401);
    const body = await json(res);
    expectErrEnvelope(body, "UNAUTHORIZED");
    expect(body.message).toMatch(/verify your email/i);
  });

  it("403s FEATURE_DISABLED when no published festival exists", async () => {
    resetWorld({ actor: { id: USER_ID, email: "student@example.com", confirmed: true }, festival: false });
    sb.onTable("festivals", { data: null, error: null });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FEATURE_DISABLED");
  });

  it.each([
    { name: "foreign origin", build: () => post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, origin: "https://evil.example", headers: KEY_HEADER }) },
    { name: "non-JSON content type", build: () => { const r = post("/api/checkout/base-pass", { body: {}, headers: KEY_HEADER }); r.headers.set("content-type", "text/plain"); return r; } },
  ] as const)("rejects $name with ORIGIN/content-type errors", async ({ build }) => {
    const res = await basePassCheckout(build());
    expect(res.status).toBe(400);
    expectErrEnvelope(await json(res), "BAD_REQUEST");
    expect(sb.calls.length).toBe(0);
  });

  it("requires a UUID Idempotency-Key header", async () => {
    seedGuards();

    const missing = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID } })
    );
    expect(missing.status).toBe(400);
    const missBody = await json(missing);
    expectErrEnvelope(missBody, "BAD_REQUEST");
    expect(missBody.message).toMatch(/Idempotency-Key header is required/);

    seedGuards(); // fresh prelude for the second request
    const malformed = await basePassCheckout(
      post("/api/checkout/base-pass", {
        body: { passProductId: PRODUCT_ID },
        headers: { "idempotency-key": "not-a-uuid" },
      })
    );
    expect(malformed.status).toBe(400);
    const malBody = await json(malformed);
    expectErrEnvelope(malBody, "BAD_REQUEST");
    expect(malBody.message).toMatch(/must be a UUID/i);
  });

  it("422s unknown body fields (strict schema) and never trusts client amounts", async () => {
    seedGuards();

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", {
        body: { passProductId: PRODUCT_ID, amountRupees: 1 }, // attacker-supplied price
        headers: KEY_HEADER,
      })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
    expect(rzp.orders.create).not.toHaveBeenCalled();
  });
});

describe("base-pass checkout — sales controls (plan §11.5)", () => {
  it("503s MAINTENANCE when maintenance_mode is on", async () => {
    seedGuards({ maintenance: true });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(503);
    expectErrEnvelope(await json(res), "MAINTENANCE");
  });

  it("409s SALES_PAUSED when the flag is off", async () => {
    seedGuards({ sales: false });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "SALES_PAUSED");
  });

  it("fails closed when the sales flag cannot be determined", async () => {
    seedGuards({ salesRow: false });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FEATURE_DISABLED");
  });

  it("429s when the per-user order limiter trips", async () => {
    seedGuards();
    rateLimiter.reset("limited");

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(429);
    expectErrEnvelope(await json(res), "RATE_LIMITED");
  });

  it("503s RATE_LIMIT_UNAVAILABLE when the limiter cannot be reached", async () => {
    seedGuards();
    rateLimiter.reset("unavailable");

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(503);
    expectErrEnvelope(await json(res), "RATE_LIMIT_UNAVAILABLE");
  });
});

describe("base-pass checkout — inventory/provider failure paths", () => {
  it.each([
    ["SOLD_OUT", "SOLD_OUT"],
    ["SALES_CLOSED", "SALES_CLOSED"],
    ["BASE_PASS_EXISTS", "BASE_PASS_EXISTS"],
    ["IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_MISMATCH"],
    ["TEAM_NOT_READY", "TEAM_NOT_READY"],
  ] as const)("maps %s from the checkout transaction to %s", async (rpcCode, apiCode) => {
    seedGuards();
    sb.onRpc("create_base_pass_checkout", { data: null, error: { message: rpcCode } });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), apiCode);
  });

  it("releases the hold and cancels the order on definitive provider rejection (4xx)", async () => {
    seedGuards();
    sb.onRpc("create_base_pass_checkout", { data: { orderId: ORDER_ID, replayed: false }, error: null });
    sb.onTable("orders", { data: { amount_paise: "20000", currency: "INR" }, error: null });
    rzp.orders.create.mockRejectedValueOnce(Object.assign(new Error("bad request"), { statusCode: 400 }));
    // releaseLocalOrder chain
    sb.onTable("order_lines", { data: { id: "line-1" }, error: null });
    sb.onTable("capacity_holds", { data: null, error: null });
    sb.onRpc("expire_holds_batch", { data: { expired: 1 }, error: null });
    sb.onTable("orders", { data: null, error: null });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(502);
    expectErrEnvelope(await json(res), "UPSTREAM_ERROR");

    expect(sb.rpcParams("expire_holds_batch")?.p_batch_size).toBe(100);
    const cancel = sb.callsFor("orders").find((c) => c.action === "update");
    expect((cancel!.payload as Record<string, unknown>).checkout_state).toBe("CANCELLED");
  });

  it("keeps the order in provisioning on uncertain provider failures (network)", async () => {
    seedGuards();
    sb.onRpc("create_base_pass_checkout", { data: { orderId: ORDER_ID, replayed: false }, error: null });
    sb.onTable("orders", { data: { amount_paise: "20000", currency: "INR" }, error: null });
    rzp.orders.create.mockRejectedValueOnce(new Error("fetch failed"));
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        public_order_code: "PO-E2E002",
        checkout_state: "PROVISIONING_PROVIDER",
        amount_paise: "20000",
        currency: "INR",
        hold_expires_at: null,
      },
      error: null,
    });
    sb.onTable("razorpay_orders", { data: null, error: null });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.status).toBe("PROVISIONING_PROVIDER");
    expect(body.data.razorpayOrderId).toBeNull();
    // Nothing was released — reconciliation owns this order now.
    expect(sb.callsFor("expire_holds_batch")).toHaveLength(0);
  });

  it("replays the original order for a repeated idempotency key", async () => {
    seedGuards();
    sb.onRpc("create_base_pass_checkout", { data: { orderId: ORDER_ID, replayed: true }, error: null });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        public_order_code: "PO-E2E001",
        checkout_state: "AWAITING_PAYMENT",
        amount_paise: "20000",
        currency: "INR",
        hold_expires_at: null,
      },
      error: null,
    });
    sb.onTable("razorpay_orders", { data: { razorpay_order_id: RZP_ORDER }, error: null });

    const res = await basePassCheckout(
      post("/api/checkout/base-pass", { body: { passProductId: PRODUCT_ID }, headers: KEY_HEADER })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.localOrderId).toBe(ORDER_ID);
    expect(rzp.orders.create).not.toHaveBeenCalled();
    expect(sb.callsFor("attach_razorpay_order")).toHaveLength(0);
  });
});

describe("POST /api/checkout/events/:eventId (plan §12.5)", () => {
  function seedEventCheckout(rpcData: Record<string, unknown>): void {
    seedGuards();
    sb.onRpc("create_event_checkout", { data: rpcData, error: null });
  }

  it("fulfills a zero-price event instantly WITHOUT touching Razorpay", async () => {
    seedEventCheckout({ orderId: ORDER_ID, replayed: false, amountPaise: 0 });
    sb.onTable("orders", { data: { amount_paise: "0", currency: "INR" }, error: null });
    sb.onRpc("attach_razorpay_order", { data: {}, error: null });
    sb.onRpc("apply_captured_payment", { data: { result: "FULFILLED" }, error: null });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        public_order_code: "PO-FREEEV",
        checkout_state: "FULFILLED",
        amount_paise: "0",
        currency: "INR",
        hold_expires_at: null,
      },
      error: null,
    });
    sb.onTable("razorpay_orders", {
      data: { razorpay_order_id: `free_${ORDER_ID.replace(/-/g, "")}` },
      error: null,
    });

    const res = await eventCheckout(
      post(`/api/checkout/events/${EVENT_ID}`, {
        body: { registrationMode: "INDIVIDUAL" },
        headers: KEY_HEADER,
      }),
      ctx({ eventId: EVENT_ID })
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.status).toBe("FULFILLED");

    const apply = sb.rpcParams("apply_captured_payment");
    expect(apply?.p_provider_status).toBe("captured");
    expect(apply?.p_amount_paise).toBe(0);
    expect(rzp.orders.create).not.toHaveBeenCalled();
  });

  it("reserves paid-event inventory server-side and exposes the poll URL shape", async () => {
    seedEventCheckout({ orderId: ORDER_ID, replayed: false, amountPaise: 15000 });
    rzp.orders.create.mockResolvedValueOnce({ id: RZP_ORDER, status: "created" });
    sb.onRpc("attach_razorpay_order", { data: {}, error: null });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        public_order_code: "PO-PAIDEV",
        checkout_state: "AWAITING_PAYMENT",
        amount_paise: "15000",
        currency: "INR",
        hold_expires_at: "2026-08-22T10:05:00Z",
      },
      error: null,
    });
    sb.onTable("razorpay_orders", { data: { razorpay_order_id: RZP_ORDER }, error: null });

    const res = await eventCheckout(
      post(`/api/checkout/events/${EVENT_ID}`, {
        body: { registrationMode: "INDIVIDUAL" },
        headers: KEY_HEADER,
      }),
      ctx({ eventId: EVENT_ID })
    );
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.amountPaise).toBe(15000);

    const rpc = sb.rpcParams("create_event_checkout");
    expect(rpc?.p_event_id).toBe(EVENT_ID);
    expect(rpc?.p_team_draft_id).toBeNull();
    expect(rzp.orders.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 15000 }));
  });

  it("passes the team draft through for TEAM registration", async () => {
    const draftId = "5e5e5e5e-5e5e-4e5e-8e5e-5e5e5e5e5e5e";
    seedEventCheckout({ orderId: ORDER_ID, replayed: true, amountPaise: 15000 });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        public_order_code: "PO-TEAM01",
        checkout_state: "AWAITING_PAYMENT",
        amount_paise: "15000",
        currency: "INR",
        hold_expires_at: null,
      },
      error: null,
    });
    sb.onTable("razorpay_orders", { data: { razorpay_order_id: RZP_ORDER }, error: null });

    await eventCheckout(
      post(`/api/checkout/events/${EVENT_ID}`, {
        body: { registrationMode: "TEAM", teamDraftId: draftId },
        headers: KEY_HEADER,
      }),
      ctx({ eventId: EVENT_ID })
    );
    expect(sb.rpcParams("create_event_checkout")?.p_team_draft_id).toBe(draftId);
    expect(rzp.orders.create).not.toHaveBeenCalled(); // replayed
  });

  it("422s TEAM registration without a teamDraftId", async () => {
    seedGuards();

    const res = await eventCheckout(
      post(`/api/checkout/events/${EVENT_ID}`, {
        body: { registrationMode: "TEAM" },
        headers: KEY_HEADER,
      }),
      ctx({ eventId: EVENT_ID })
    );
    expect(res.status).toBe(422);
    const body = await json(res);
    expectErrEnvelope(body, "VALIDATION_FAILED");
    expect(JSON.stringify(body.details)).toMatch(/teamDraftId is required/);
  });

  it("surfaces SOLD_OUT to the client as a 409", async () => {
    seedGuards();
    sb.onRpc("create_event_checkout", { data: null, error: { message: "SOLD_OUT" } });

    const res = await eventCheckout(
      post(`/api/checkout/events/${EVENT_ID}`, {
        body: { registrationMode: "INDIVIDUAL" },
        headers: KEY_HEADER,
      }),
      ctx({ eventId: EVENT_ID })
    );
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "SOLD_OUT");
  });
});

describe("GET /api/checkout/orders/:orderId (plan §12.6.7)", () => {
  function seedOwnerPoll(): void {
    sb.onTable("festivals", { data: { id: FESTIVAL_ID }, error: null });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        public_order_code: "PO-E2E001",
        purchaser_user_id: USER_ID,
        checkout_state: "AWAITING_PAYMENT",
        amount_paise: "20000",
        currency: "INR",
        hold_expires_at: "2026-08-22T10:10:00Z",
        fulfilled_at: null,
        created_at: "2026-08-22T09:55:00Z",
      },
      error: null,
    });
    sb.onTable("razorpay_orders", { data: { razorpay_order_id: RZP_ORDER }, error: null });
  }

  it("returns the caller's order with the latest payment state", async () => {
    seedOwnerPoll();
    sb.onTable("payments", { data: { provider_status: "captured" }, error: null });

    const res = await orderStatus(get(`/api/checkout/orders/${ORDER_ID}`), ctx({ orderId: ORDER_ID }));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data).toMatchObject({
      localOrderId: ORDER_ID,
      status: "AWAITING_PAYMENT",
      amountPaise: 20000,
      paymentState: "captured",
    });
  });

  it("reports a null paymentState while the provider order is still provisioning", async () => {
    seedOwnerPoll();
    sb.onTable("payments", { data: null, error: null });

    const res = await orderStatus(get(`/api/checkout/orders/${ORDER_ID}`), ctx({ orderId: ORDER_ID }));
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.paymentState).toBeNull();
  });

  it("403s another user's order (owner-only polling)", async () => {
    sb.onTable("festivals", { data: { id: FESTIVAL_ID }, error: null });
    sb.onTable("orders", {
      data: { id: ORDER_ID, purchaser_user_id: "99999999-9999-4999-8999-999999999999" },
      error: null,
    });

    const res = await orderStatus(get(`/api/checkout/orders/${ORDER_ID}`), ctx({ orderId: ORDER_ID }));
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });

  it("404s an unknown order id", async () => {
    sb.onTable("festivals", { data: { id: FESTIVAL_ID }, error: null });
    sb.onTable("orders", { data: null, error: null });

    const res = await orderStatus(get(`/api/checkout/orders/${ORDER_ID}`), ctx({ orderId: ORDER_ID }));
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });
});

describe("order cancellation (plan §12.6)", () => {
  it("cancels an open in-progress order successfully", async () => {
    sb.onTable("festivals", { data: { id: FESTIVAL_ID }, error: null });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        purchaser_user_id: USER_ID,
        checkout_state: "AWAITING_PAYMENT",
        kind: "BASE_PASS",
      },
      error: null,
    });
    sb.onTable("capacity_holds", { data: [], error: null });
    sb.onRpc("cancel_order", {
      data: { cancelled: true, orderId: ORDER_ID, state: "CANCELLED", releasedHolds: 0 },
      error: null,
    });

    const res = await cancelOrderRoute(
      post(`/api/checkout/orders/${ORDER_ID}/cancel`),
      { params: Promise.resolve({ orderId: ORDER_ID }) }
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data).toMatchObject({ cancelled: true, orderId: ORDER_ID });
  });

  it("403s when attempting to cancel another user's order", async () => {
    sb.onTable("festivals", { data: { id: FESTIVAL_ID }, error: null });
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        purchaser_user_id: "99999999-9999-4999-8999-999999999999",
        checkout_state: "AWAITING_PAYMENT",
      },
      error: null,
    });
    sb.onRpc("cancel_order", { data: null, error: { message: "FORBIDDEN" } });

    const res = await cancelOrderRoute(
      post(`/api/checkout/orders/${ORDER_ID}/cancel`),
      { params: Promise.resolve({ orderId: ORDER_ID }) }
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });
});
