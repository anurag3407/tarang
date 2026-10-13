import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ORDER_ID,
  USER_ID,
  flushAfter,
  resetWorld,
  rzp,
  sb,
} from "./helpers/mocks";
import { ctx, get, json, expectOkEnvelope, rawPost } from "./helpers/requests";

/**
 * Payment recovery journeys (plan §12.7, §12.8, §12.15).
 *
 * The single-step behaviours are covered in payment-webhooks.e2e.test.ts. This
 * file covers the multi-step failure SEQUENCES that only appear with live keys,
 * where the browser drops out mid-payment and money has already moved:
 *
 *   A. Browser dies after capture      -> webhook finishes the job
 *   B. Browser dies AND webhook lost   -> reconciler finishes the job
 *   C. ...and a sweeper already gave up on the order -> cold reconcile
 *   D. Webhooks arriving out of order  -> captured always wins
 *   E. Browser callback races webhook  -> exactly one fulfillment
 *   F. order.paid without a payment entity -> resolved via the provider
 *   G. Web process dies mid-webhook    -> the stale claim is reclaimed
 *   H. A swept order the provider has a payment for -> no retry is offered
 *
 * The invariant under test: once money is captured, SOME path reaches
 * apply_captured_payment, and no path fulfils twice — and no screen ever tells
 * a user to pay again while money we already hold is unaccounted for.
 */

const WHSEC = "whsec_journeys_e2e_0123456789abcdef";
process.env.RAZORPAY_WEBHOOK_SECRET_CURRENT = WHSEC;

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
vi.mock("next/server", async (importOriginal) => {
  const [actual, m] = await Promise.all([
    importOriginal<typeof import("next/server")>(),
    import("./helpers/mocks"),
  ]);
  return { ...actual, after: (fn: () => unknown) => m.enqueueAfter(fn) };
});

const { POST: razorpayWebhookRoute } = await import(
  "@/app/api/webhooks/razorpay/route"
);
const { GET: orderStatus } = await import(
  "@/app/api/checkout/orders/[orderId]/route"
);
const { runPaymentReconciler } = await import("@/workers/payment-reconciler");

const RZP_ORDER = "order_JOURNEY1";
const RZP_PAYMENT = "pay_JOURNEY1";
const AMOUNT = 20000;

/** A signed webhook delivery, as Razorpay sends it. */
function delivery(body: unknown, eventId: string) {
  const raw = JSON.stringify(body);
  return rawPost("/api/webhooks/razorpay", raw, {
    "x-razorpay-signature": createHmac("sha256", WHSEC).update(raw).digest("hex"),
    "x-razorpay-event-id": eventId,
  });
}

function paymentEvent(event: string, status: string) {
  return {
    event,
    payload: {
      payment: {
        entity: {
          id: RZP_PAYMENT,
          order_id: RZP_ORDER,
          amount: AMOUNT,
          currency: "INR",
          status,
          created_at: 1_755_000_000,
        },
      },
    },
  };
}

/** Seed the inbox insert + the processor's single-row read. */
function seedInbox(rowId: string, body: unknown, eventType: string) {
  sb.onTable("webhook_events", { data: { id: rowId }, error: null });
  sb.onTable("webhook_events", {
    data: {
      id: rowId,
      event_type: eventType,
      raw_body: body,
      processing_state: "RECEIVED",
      attempts: 0,
    },
    error: null,
  });
}

/** The order row shape the reconciler's scan projects. */
function scanRow(state: string) {
  return {
    id: ORDER_ID,
    checkout_state: state,
    hold_expires_at: null,
    razorpay_orders: { razorpay_order_id: RZP_ORDER },
  };
}

function capturedPayment() {
  return {
    id: RZP_PAYMENT,
    status: "captured",
    amount: AMOUNT,
    currency: "INR",
    created_at: 1_755_000_000,
  };
}

/** Queue the reconciler's live scan, cold scan and webhook-retry reads. */
function seedReconcilerScans(live: unknown[], cold: unknown[]) {
  sb.onTable("orders", { data: live, error: null });
  sb.onTable("orders", { data: cold, error: null });
  sb.onTable("webhook_events", { data: [], error: null }); // RECEIVED/RETRY scan
  sb.onTable("webhook_events", { data: [], error: null }); // abandoned PROCESSING scan
  sb.onTable("webhook_events", { data: null, error: null }); // DEAD sweep
}

beforeEach(() => {
  resetWorld({ actor: { id: USER_ID, email: "student@example.com", confirmed: true } });
});

describe("A. the browser dies after Razorpay captured the payment", () => {
  it("fulfils from the webhook alone, and polling then reports FULFILLED", async () => {
    // The user's phone lost signal on the Razorpay success screen, so the
    // handler never called /verify. Only the webhook remains.
    const body = paymentEvent("payment.captured", "captured");
    seedInbox("wev-A", body, "payment.captured");
    sb.onRpc("apply_captured_payment", {
      data: { result: "FULFILLED", orderId: ORDER_ID },
      error: null,
    });

    const res = await razorpayWebhookRoute(delivery(body, "evt_A"));
    expect(res.status).toBe(200);
    await flushAfter();

    expect(sb.rpcParams("apply_captured_payment")).toMatchObject({
      p_razorpay_payment_id: RZP_PAYMENT,
      p_amount_paise: AMOUNT,
      p_provider_status: "captured",
    });

    // The dashboard/poll the user returns to now shows the pass as active.
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        public_order_code: "TARANG-A1",
        purchaser_user_id: USER_ID,
        checkout_state: "FULFILLED",
        amount_paise: String(AMOUNT),
        currency: "INR",
        hold_expires_at: null,
        fulfilled_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
      error: null,
    });
    sb.onTable("razorpay_orders", { data: { razorpay_order_id: RZP_ORDER }, error: null });
    sb.onTable("payments", { data: { provider_status: "captured" }, error: null });

    const poll = await orderStatus(
      get(`/api/checkout/orders/${ORDER_ID}`),
      ctx({ orderId: ORDER_ID })
    );
    const body2 = await json(poll);
    expectOkEnvelope(body2);
    expect(body2.data).toMatchObject({ status: "FULFILLED", paymentState: "captured" });
  });
});

describe("B. the browser dies AND the webhook never arrives", () => {
  it("the reconciler finds the capture by asking Razorpay directly", async () => {
    // Nothing local knows a payment happened: no /verify call, no webhook row.
    // The order is still AWAITING_PAYMENT, so the live scan covers it.
    seedReconcilerScans([scanRow("AWAITING_PAYMENT")], []);
    rzp.orders.fetchPayments.mockResolvedValueOnce({ items: [capturedPayment()] });
    sb.onRpc("apply_captured_payment", {
      data: { result: "FULFILLED", orderId: ORDER_ID },
      error: null,
    });

    const result = await runPaymentReconciler();

    expect(rzp.orders.fetchPayments).toHaveBeenCalledWith(RZP_ORDER);
    expect(result.resolvedOrders).toBe(1);
  });
});

/**
 * The scenario that used to lose money silently: the capture landed, the
 * webhook was lost for longer than the hold window, and the hold reaper (or
 * the base-pass self-heal) had already moved the order out of the states the
 * reconciler watched. Nothing looked at it again.
 */
describe("C. ...and a sweeper already gave up on the order", () => {
  it("recovers an EXPIRED event order via the cold scan", async () => {
    seedReconcilerScans([], [scanRow("EXPIRED")]);
    rzp.orders.fetchPayments.mockResolvedValueOnce({ items: [capturedPayment()] });
    sb.onRpc("apply_captured_payment", {
      data: { result: "FULFILLED", orderId: ORDER_ID },
      error: null,
    });

    const result = await runPaymentReconciler();

    expect(result.resolvedOrders).toBe(1);
    expect(result.lateDiscoveries).toBe(1);
  });

  it("recovers a CANCELLED base-pass order via the cold scan", async () => {
    seedReconcilerScans([], [scanRow("CANCELLED")]);
    rzp.orders.fetchPayments.mockResolvedValueOnce({ items: [capturedPayment()] });
    sb.onRpc("apply_captured_payment", {
      data: { result: "FULFILLED", orderId: ORDER_ID },
      error: null,
    });

    const result = await runPaymentReconciler();

    expect(result.resolvedOrders).toBe(1);
    expect(result.lateDiscoveries).toBe(1);
  });

  it("flags an unfulfillable late capture as a refund obligation, not a success", async () => {
    // Capacity was resold in the meantime: the money is real but the seat is
    // gone, so it becomes a manual refund rather than a silent loss.
    seedReconcilerScans([], [scanRow("EXPIRED")]);
    rzp.orders.fetchPayments.mockResolvedValueOnce({ items: [capturedPayment()] });
    sb.onRpc("apply_captured_payment", {
      data: {
        result: "REFUND_REQUIRED",
        orderId: ORDER_ID,
        reason: "late_payment_no_capacity",
      },
      error: null,
    });

    const result = await runPaymentReconciler();

    expect(result.refundRequired).toBe(1);
    expect(result.resolvedOrders).toBe(0);
    expect(result.lateDiscoveries).toBe(0);
  });
});

describe("D. webhooks arriving out of order", () => {
  it("a late payment.failed after a capture never un-fulfils the order", async () => {
    // Razorpay events are unordered snapshots. The failed event must not
    // reach apply_captured_payment, and the payments upsert must not
    // overwrite the captured status.
    const failedBody = paymentEvent("payment.failed", "failed");
    seedInbox("wev-D", failedBody, "payment.failed");
    sb.onTable("payments", { data: null, error: null }); // upsert, ignoreDuplicates

    const res = await razorpayWebhookRoute(delivery(failedBody, "evt_D"));
    expect(res.status).toBe(200);
    await flushAfter();

    expect(sb.callsFor("apply_captured_payment").length).toBe(0);
    const upsert = sb.callsFor("payments").find((c) => c.action === "upsert");
    expect(upsert?.payload).toMatchObject({ provider_status: "failed" });
  });

  it("a capture arriving after a failure still fulfils", async () => {
    const capturedBody = paymentEvent("payment.captured", "captured");
    seedInbox("wev-D2", capturedBody, "payment.captured");
    sb.onRpc("apply_captured_payment", {
      data: { result: "FULFILLED", orderId: ORDER_ID },
      error: null,
    });

    await razorpayWebhookRoute(delivery(capturedBody, "evt_D2"));
    await flushAfter();

    expect(sb.callsFor("apply_captured_payment").length).toBe(1);
  });
});

describe("E. the browser callback races the webhook", () => {
  it("both paths apply the same payment but only one fulfillment results", async () => {
    // Whoever arrives second gets ALREADY_APPLIED from the SQL function's
    // at-most-once guard, which the reconciler counts as settled, not failed.
    seedReconcilerScans([scanRow("AWAITING_PAYMENT")], []);
    rzp.orders.fetchPayments.mockResolvedValueOnce({ items: [capturedPayment()] });
    sb.onRpc("apply_captured_payment", {
      data: { result: "ALREADY_APPLIED", orderId: ORDER_ID },
      error: null,
    });

    const result = await runPaymentReconciler();

    expect(result.resolvedOrders).toBe(1);
    expect(result.refundRequired).toBe(0);
  });
});

describe("F. order.paid carries no payment entity", () => {
  it("resolves the payment id from the provider and applies it", async () => {
    const orderPaidBody = {
      event: "order.paid",
      payload: { order: { entity: { id: RZP_ORDER, amount: AMOUNT, status: "paid" } } },
    };
    seedInbox("wev-F", orderPaidBody, "order.paid");
    rzp.orders.fetchPayments.mockResolvedValueOnce({ items: [capturedPayment()] });
    sb.onRpc("apply_captured_payment", {
      data: { result: "FULFILLED", orderId: ORDER_ID },
      error: null,
    });

    const res = await razorpayWebhookRoute(delivery(orderPaidBody, "evt_F"));
    expect(res.status).toBe(200);
    await flushAfter();

    expect(rzp.orders.fetchPayments).toHaveBeenCalledWith(RZP_ORDER);
    expect(sb.rpcParams("apply_captured_payment")).toMatchObject({
      p_razorpay_payment_id: RZP_PAYMENT,
      p_razorpay_order_id: RZP_ORDER,
      p_provider_status: "captured",
    });
  });

  it("retries rather than acknowledging when the provider lookup fails", async () => {
    const orderPaidBody = {
      event: "order.paid",
      payload: { order: { entity: { id: RZP_ORDER, amount: AMOUNT, status: "paid" } } },
    };
    seedInbox("wev-F2", orderPaidBody, "order.paid");
    rzp.orders.fetchPayments.mockRejectedValueOnce(new Error("ETIMEDOUT"));

    const res = await razorpayWebhookRoute(delivery(orderPaidBody, "evt_F2"));
    expect(res.status).toBe(200);
    await flushAfter();

    expect(sb.callsFor("apply_captured_payment").length).toBe(0);

    // Razorpay already has its 2xx, so it will never redeliver this event.
    // Marking it PROCESSED would therefore discard the only local record that
    // this order was paid — leaving the order-scan as the sole recovery, which
    // does not cover an order outside the reconciler's state list or lookback
    // window. RETRY keeps it on retryStuckWebhookEvents' work list instead.
    const states = sb
      .callsFor("webhook_events")
      .filter((c) => c.action === "update")
      .map((c) => (c.payload as { processing_state?: string })?.processing_state);
    expect(states).toContain("RETRY");
    expect(states).not.toContain("PROCESSED");
  });
});

/**
 * G. The matrix row "crash during webhook". The handler set PROCESSING and then
 * died — a deploy mid-flight, an OOM kill, a crashed web process. Razorpay has
 * its 2xx so it never redelivers, and before this pass nothing in the system
 * looked at the PROCESSING state at all: the money sat captured with no pass
 * issued and no alert raised.
 */
describe("G. the web process dies mid-webhook, leaving the row PROCESSING", () => {
  it("the reconciler reclaims the abandoned claim and completes the fulfillment", async () => {
    const body = paymentEvent("payment.captured", "captured");

    sb.onTable("orders", { data: [], error: null }); // live scan
    sb.onTable("orders", { data: [], error: null }); // cold scan
    sb.onTable("webhook_events", { data: [], error: null }); // nothing in RECEIVED/RETRY
    sb.onTable("webhook_events", { data: [{ id: "wev-G" }], error: null }); // the dead claim
    sb.onTable("webhook_events", {
      data: {
        id: "wev-G",
        event_type: "payment.captured",
        raw_body: body,
        processing_state: "PROCESSING",
        attempts: 1,
      },
      error: null,
    });
    sb.onTable("webhook_events", { data: null, error: null }); // re-claim update
    sb.onRpc("apply_captured_payment", {
      data: { result: "FULFILLED", orderId: ORDER_ID },
      error: null,
    });
    sb.onTable("webhook_events", { data: null, error: null }); // PROCESSED
    sb.onTable("webhook_events", { data: null, error: null }); // DEAD sweep

    const result = await runPaymentReconciler();

    expect(result.retriedWebhooks).toBe(1);
    expect(sb.rpcParams("apply_captured_payment")).toMatchObject({
      p_razorpay_payment_id: RZP_PAYMENT,
      p_provider_status: "captured",
    });
    // Terminal, not back where it started: a reclaim that re-stranded the row
    // would loop forever.
    const states = sb
      .callsFor("webhook_events")
      .filter((c) => c.action === "update")
      .map((c) => (c.payload as { processing_state?: string })?.processing_state);
    expect(states).toContain("PROCESSED");
  });

  it("only reclaims claims older than the staleness threshold", async () => {
    sb.onTable("orders", { data: [], error: null });
    sb.onTable("orders", { data: [], error: null });
    sb.onTable("webhook_events", { data: [], error: null });
    sb.onTable("webhook_events", { data: [], error: null });
    sb.onTable("webhook_events", { data: null, error: null });

    await runPaymentReconciler();

    // A row a healthy worker is legitimately still processing must never be
    // stolen out from under it, so staleness is measured from the claim stamp.
    const scan = sb
      .callsFor("webhook_events")
      .filter((c) => c.action === "select")
      .at(1);
    expect(scan?.filters["processing_state"]).toBe("PROCESSING");
    expect(scan?.filters["processing_started_at:lt"]).toBeDefined();
  });
});

/**
 * H. The gap the recovery work itself opened. 0013 keeps swept orders
 * recoverable for a bounded window, so an EXPIRED order can still be fulfilled
 * from a late capture. If the checkout UI treats EXPIRED as "nothing happened,
 * start over", the user pays a second time: the first payment recovers and
 * issues the pass, the second hits the duplicate guard and becomes a manual
 * refund. `paymentObserved` is what lets the UI tell the two cases apart.
 */
describe("H. a swept order the provider has a payment for", () => {
  function seedPollOrder(state: string, payment: Record<string, unknown> | null) {
    sb.onTable("orders", {
      data: {
        id: ORDER_ID,
        public_order_code: "TARANG-H1",
        purchaser_user_id: USER_ID,
        checkout_state: state,
        amount_paise: String(AMOUNT),
        currency: "INR",
        hold_expires_at: null,
        fulfilled_at: null,
        created_at: new Date().toISOString(),
      },
      error: null,
    });
    sb.onTable("razorpay_orders", { data: { razorpay_order_id: RZP_ORDER }, error: null });
    sb.onTable("payments", { data: payment, error: null });
  }

  it("reports paymentObserved so the UI keeps waiting instead of re-charging", async () => {
    seedPollOrder("EXPIRED", { provider_status: "captured", disposition: null });

    const poll = await orderStatus(
      get(`/api/checkout/orders/${ORDER_ID}`),
      ctx({ orderId: ORDER_ID })
    );
    const body = await json(poll);
    expectOkEnvelope(body);
    expect(body.data).toMatchObject({
      status: "EXPIRED",
      paymentObserved: true,
      underReview: false,
    });
  });

  it("reports paymentObserved for an authorized-not-captured payment too", async () => {
    // The worst case to get wrong: money is debited, capture has not landed.
    // Narrowing this flag to "captured" would tell the user to pay again.
    seedPollOrder("EXPIRED", { provider_status: "authorized", disposition: null });

    const poll = await orderStatus(
      get(`/api/checkout/orders/${ORDER_ID}`),
      ctx({ orderId: ORDER_ID })
    );
    const body = await json(poll);
    expectOkEnvelope(body);
    expect(body.data.paymentObserved).toBe(true);
  });

  it("leaves paymentObserved false on a genuinely abandoned order", async () => {
    // Nobody ever paid, so a fresh order (and a new idempotency key) is right.
    seedPollOrder("EXPIRED", null);

    const poll = await orderStatus(
      get(`/api/checkout/orders/${ORDER_ID}`),
      ctx({ orderId: ORDER_ID })
    );
    const body = await json(poll);
    expectOkEnvelope(body);
    expect(body.data.paymentObserved).toBe(false);
    expect(body.data.underReview).toBe(false);
  });

  it("flags PAYMENT_REVIEW as underReview so no screen offers a retry", async () => {
    seedPollOrder("PAYMENT_REVIEW", { provider_status: "captured", disposition: "REVIEW" });

    const poll = await orderStatus(
      get(`/api/checkout/orders/${ORDER_ID}`),
      ctx({ orderId: ORDER_ID })
    );
    const body = await json(poll);
    expectOkEnvelope(body);
    expect(body.data).toMatchObject({ status: "PAYMENT_REVIEW", underReview: true });
  });

  it("flags a refund obligation as underReview even while the order reads FULFILLED", async () => {
    // The duplicate-purchase case: the order is fulfilled from the first
    // payment, and the second payment is what we owe back.
    seedPollOrder("FULFILLED", {
      provider_status: "captured",
      disposition: "REFUND_REQUIRED",
    });

    const poll = await orderStatus(
      get(`/api/checkout/orders/${ORDER_ID}`),
      ctx({ orderId: ORDER_ID })
    );
    const body = await json(poll);
    expectOkEnvelope(body);
    expect(body.data.underReview).toBe(true);
  });
});
