import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockSupabase, fail, ok } from "./helpers/supabase-mock";

const sb = new MockSupabase();

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => sb,
}));

const rzpMock = {
  payments: { fetch: vi.fn(), refund: vi.fn() },
  orders: { fetchPayments: vi.fn(), create: vi.fn() },
  refunds: { fetch: vi.fn() },
};
vi.mock("@/lib/razorpay/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/razorpay/client")>();
  return {
    ...actual,
    getRazorpay: () => rzpMock,
  };
});

import {
  bodyHash,
  processRazorpayWebhookEvent,
  retryStuckWebhookEvents,
  verifyAndApplyBrowserCallback,
} from "@/services/payment-service";

const SECRET = process.env.RAZORPAY_KEY_SECRET!;
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const RZP_ORDER = "order_RZP1";
const RZP_PAYMENT = "pay_RZP1";

function validSignature(orderId: string, paymentId: string): string {
  return createHmac("sha256", SECRET).update(`${orderId}|${paymentId}`).digest("hex");
}

beforeEach(() => {
  sb.calls = [];
  vi.clearAllMocks();
});

describe("verifyAndApplyBrowserCallback (plan §12.7)", () => {
  it("rejects an invalid HMAC before touching the database", async () => {
    await expect(
      verifyAndApplyBrowserCallback(USER_ID, RZP_ORDER, RZP_PAYMENT, "badsig")
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" });
    expect(sb.calls.length).toBe(0);
  });

  it("rejects an unknown provider order", async () => {
    sb.onTable("razorpay_orders", ok(null));
    await expect(
      verifyAndApplyBrowserCallback(
        USER_ID,
        RZP_ORDER,
        RZP_PAYMENT,
        validSignature(RZP_ORDER, RZP_PAYMENT)
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects when the order belongs to another user", async () => {
    sb.onTable(
      "razorpay_orders",
      ok({ local_order_id: ORDER_ID, expected_amount_paise: "20000", currency: "INR" })
    );
    sb.onTable("orders", ok({ id: ORDER_ID, purchaser_user_id: "someone-else", amount_paise: "20000", currency: "INR" }));
    await expect(
      verifyAndApplyBrowserCallback(
        USER_ID,
        RZP_ORDER,
        RZP_PAYMENT,
        validSignature(RZP_ORDER, RZP_PAYMENT)
      )
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("applies a captured payment after provider confirmation", async () => {
    sb.onTable(
      "razorpay_orders",
      ok({ local_order_id: ORDER_ID, expected_amount_paise: "20000", currency: "INR" })
    );
    sb.onTable("orders", ok({ id: ORDER_ID, purchaser_user_id: USER_ID, amount_paise: "20000", currency: "INR" }));
    rzpMock.payments.fetch.mockResolvedValueOnce({
      status: "captured",
      amount: 20000,
      created_at: 1750000000,
    });
    sb.onRpc("apply_captured_payment", ok({ result: "FULFILLED", orderId: ORDER_ID }));

    const res = await verifyAndApplyBrowserCallback(
      USER_ID,
      RZP_ORDER,
      RZP_PAYMENT,
      validSignature(RZP_ORDER, RZP_PAYMENT)
    );
    expect(res.result).toBe("FULFILLED");
    expect(res.orderId).toBe(ORDER_ID);

    const params = sb.rpcParams("apply_captured_payment");
    expect(params?.p_razorpay_payment_id).toBe(RZP_PAYMENT);
    expect(params?.p_amount_paise).toBe(20000);
    expect(params?.p_provider_status).toBe("captured");
  });

  it("returns PROCESSING when the provider has not captured yet", async () => {
    sb.onTable(
      "razorpay_orders",
      ok({ local_order_id: ORDER_ID, expected_amount_paise: "20000", currency: "INR" })
    );
    sb.onTable("orders", ok({ id: ORDER_ID, purchaser_user_id: USER_ID, amount_paise: "20000", currency: "INR" }));
    rzpMock.payments.fetch.mockResolvedValueOnce({ status: "authorized", amount: 20000 });

    const res = await verifyAndApplyBrowserCallback(
      USER_ID,
      RZP_ORDER,
      RZP_PAYMENT,
      validSignature(RZP_ORDER, RZP_PAYMENT)
    );
    expect(res.result).toBe("PROCESSING");
    expect(sb.callsFor("apply_captured_payment").length).toBe(0);
  });

  it("defers to webhook/reconciler when the provider is unreachable", async () => {
    sb.onTable(
      "razorpay_orders",
      ok({ local_order_id: ORDER_ID, expected_amount_paise: "20000", currency: "INR" })
    );
    sb.onTable("orders", ok({ id: ORDER_ID, purchaser_user_id: USER_ID, amount_paise: "20000", currency: "INR" }));
    rzpMock.payments.fetch.mockRejectedValueOnce(new Error("network down"));

    const res = await verifyAndApplyBrowserCallback(
      USER_ID,
      RZP_ORDER,
      RZP_PAYMENT,
      validSignature(RZP_ORDER, RZP_PAYMENT)
    );
    expect(res.result).toBe("PROCESSING");
    expect(sb.callsFor("apply_captured_payment").length).toBe(0);
  });
});

describe("processRazorpayWebhookEvent (plan §12.8)", () => {
  const WEBHOOK_ROW_ID = "33333333-3333-4333-8333-333333333333";

  function capturedEventRow() {
    return {
      id: WEBHOOK_ROW_ID,
      event_type: "payment.captured",
      processing_state: "RECEIVED",
      attempts: 0,
      raw_body: {
        payload: {
          payment: {
            entity: {
              id: RZP_PAYMENT,
              order_id: RZP_ORDER,
              amount: 20000,
              currency: "INR",
              status: "captured",
              created_at: 1750000000,
            },
          },
        },
      },
    };
  }

  it("skips events already PROCESSED (idempotency)", async () => {
    sb.onTable(
      "webhook_events",
      ok({ ...capturedEventRow(), processing_state: "PROCESSED" })
    );
    await processRazorpayWebhookEvent(WEBHOOK_ROW_ID);
    expect(sb.callsFor("apply_captured_payment").length).toBe(0);
  });

  it("applies a captured payment webhook", async () => {
    sb.onTable("webhook_events", ok(capturedEventRow()));
    sb.onTable("webhook_events", ok(null)); // PROCESSING update
    sb.onRpc("apply_captured_payment", ok({ result: "FULFILLED" }));
    sb.onTable("webhook_events", ok(null)); // PROCESSED update

    await processRazorpayWebhookEvent(WEBHOOK_ROW_ID);

    const params = sb.rpcParams("apply_captured_payment");
    expect(params?.p_razorpay_payment_id).toBe(RZP_PAYMENT);
    expect(params?.p_amount_paise).toBe(20000);
    const finalUpdate = sb
      .callsFor("webhook_events")
      .filter((c) => c.action === "update")
      .at(-1);
    expect((finalUpdate?.payload as { processing_state?: string })?.processing_state).toBe(
      "PROCESSED"
    );
  });

  it("records failed payments without downgrading captured state", async () => {
    sb.onTable("webhook_events", ok({
      ...capturedEventRow(),
      event_type: "payment.failed",
      raw_body: {
        payload: {
          payment: {
            entity: {
              id: RZP_PAYMENT,
              order_id: RZP_ORDER,
              amount: 20000,
              currency: "INR",
              status: "failed",
            },
          },
        },
      },
    }));
    sb.onTable("webhook_events", ok(null));
    sb.onTable("payments", ok(null)); // upsert with ignoreDuplicates
    sb.onTable("webhook_events", ok(null));

    await processRazorpayWebhookEvent(WEBHOOK_ROW_ID);

    expect(sb.callsFor("apply_captured_payment").length).toBe(0);
    const upsert = sb.callsFor("payments").find((c) => c.action === "upsert");
    expect(upsert).toBeDefined();
  });

  it("ignores refund.* events — refunds are manual now", async () => {
    sb.onTable("webhook_events", ok({
      ...capturedEventRow(),
      event_type: "refund.processed",
      raw_body: {
        payload: { refund: { entity: { id: "rfnd_1", status: "processed" } } },
      },
    }));
    sb.onTable("webhook_events", ok(null));
    sb.onTable("webhook_events", ok(null));

    await processRazorpayWebhookEvent(WEBHOOK_ROW_ID);

    // No refunds table write, no provider refund call.
    expect(sb.callsFor("refunds").length).toBe(0);
    expect(rzpMock.refunds.fetch).not.toHaveBeenCalled();
  });

  it("marks the event RETRY with the error when processing throws", async () => {
    sb.onTable("webhook_events", ok(capturedEventRow()));
    sb.onTable("webhook_events", ok(null));
    sb.onRpc("apply_captured_payment", fail("db down"));
    sb.onTable("webhook_events", ok(null));

    await expect(processRazorpayWebhookEvent(WEBHOOK_ROW_ID)).rejects.toThrow();
    const updates = sb.callsFor("webhook_events").filter((c) => c.action === "update");
    const retryUpdate = updates.find(
      (c) => (c.payload as { processing_state?: string })?.processing_state === "RETRY"
    );
    expect(retryUpdate).toBeDefined();
  });
});

describe("retryStuckWebhookEvents", () => {
  it("reprocesses RECEIVED/RETRY rows and dead-letters poison payloads", async () => {
    sb.onTable("webhook_events", ok([{ id: "w1" }, { id: "w2" }]));
    sb.onTable("webhook_events", ok([])); // no abandoned PROCESSING claims
    // Each processRazorpayWebhookEvent: fetch row -> PROCESSED fast path.
    sb.onTable("webhook_events", ok({ id: "w1", event_type: "x", processing_state: "PROCESSED", attempts: 1, raw_body: {} }));
    sb.onTable("webhook_events", ok({ id: "w2", event_type: "x", processing_state: "PROCESSED", attempts: 1, raw_body: {} }));
    sb.onTable("webhook_events", ok(null)); // DEAD sweep

    const retried = await retryStuckWebhookEvents();
    expect(retried).toBe(2);

    const deadSweep = sb
      .callsFor("webhook_events")
      .filter((c) => c.action === "update")
      .at(-1);
    expect((deadSweep?.payload as { processing_state?: string })?.processing_state).toBe("DEAD");
  });

  it("dead-letters a PROCESSING row too, so a row that dies every time terminates", async () => {
    sb.onTable("webhook_events", ok([]));
    sb.onTable("webhook_events", ok([]));
    sb.onTable("webhook_events", ok(null)); // DEAD sweep

    await retryStuckWebhookEvents();

    const deadSweep = sb
      .callsFor("webhook_events")
      .filter((c) => c.action === "update")
      .at(-1);
    expect(deadSweep?.filters["processing_state:in"]).toEqual([
      "RECEIVED",
      "RETRY",
      "PROCESSING",
    ]);
  });

  /**
   * The stranding this closes: the handler set PROCESSING and then died (deploy
   * mid-flight, OOM kill, crashed web process). Razorpay already has its 2xx so
   * it never redelivers, and before this pass nothing in the system looked at
   * the PROCESSING state at all.
   */
  it("reclaims a PROCESSING row whose handler died", async () => {
    sb.onTable("webhook_events", ok([])); // nothing in RECEIVED/RETRY
    sb.onTable("webhook_events", ok([{ id: "wstuck" }])); // abandoned claim
    sb.onTable(
      "webhook_events",
      ok({
        id: "wstuck",
        event_type: "payment.captured",
        processing_state: "PROCESSING",
        attempts: 1,
        raw_body: {},
      })
    );

    const retried = await retryStuckWebhookEvents();
    expect(retried).toBe(1);

    // Ended in a terminal state rather than back where it started.
    const states = sb
      .callsFor("webhook_events")
      .filter((c) => c.action === "update")
      .map((c) => (c.payload as { processing_state?: string })?.processing_state);
    expect(states).toContain("PROCESSED");
  });

  it("judges staleness by claim age, so a live claim is never stolen", async () => {
    sb.onTable("webhook_events", ok([]));
    sb.onTable("webhook_events", ok([]));

    await retryStuckWebhookEvents({ staleProcessingMs: 300_000 });

    const scan = sb
      .callsFor("webhook_events")
      .filter((c) => c.action === "select")
      .at(1);
    expect(scan?.filters["processing_state"]).toBe("PROCESSING");
    // Only claims older than the threshold, and only within the attempt budget.
    const cutoff = scan?.filters["processing_started_at:lt"] as string;
    expect(Date.now() - new Date(cutoff).getTime()).toBeGreaterThanOrEqual(299_000);
    expect(scan?.filters["attempts:lt"]).toBe(10);
  });

  it("returns 0 when the query fails (no crash)", async () => {
    sb.onTable("webhook_events", fail("db down"));
    sb.onTable("webhook_events", fail("db down"));
    await expect(retryStuckWebhookEvents()).resolves.toBe(0);
  });
});

describe("bodyHash", () => {
  it("is deterministic and changes with content", () => {
    expect(bodyHash("abc")).toBe(bodyHash("abc"));
    expect(bodyHash("abc")).not.toBe(bodyHash("abd"));
  });
});
