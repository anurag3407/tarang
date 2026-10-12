import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockSupabase, ok, fail } from "./helpers/supabase-mock";

const sb = new MockSupabase();

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => sb,
}));

const rzpMock = {
  orders: { fetchPayments: vi.fn() },
  payments: { fetch: vi.fn() },
  refunds: { fetch: vi.fn() },
};
vi.mock("@/lib/razorpay/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/razorpay/client")>();
  return { ...actual, getRazorpay: () => rzpMock };
});

import { runPaymentReconciler } from "@/workers/payment-reconciler";

beforeEach(() => {
  sb.reset();
  vi.clearAllMocks();
});

/** A captured provider payment as Razorpay returns it from fetchPayments. */
function captured(id: string, amount = 20000, createdAt = 1750000000) {
  return { id, status: "captured", amount, currency: "INR", created_at: createdAt };
}

/** An order row shaped like the reconciler's scan projection. */
function scanRow(id: string, state: string, providerOrderId: string | null) {
  return {
    id,
    checkout_state: state,
    hold_expires_at: null,
    razorpay_orders: providerOrderId ? { razorpay_order_id: providerOrderId } : null,
  };
}

/**
 * The reconciler runs two scans (live, then cold) and then the webhook retry.
 * Queue the live rows, then the cold rows, in that order.
 */
function queueScans(live: unknown[], cold: unknown[]) {
  sb.onTable("orders", ok(live));
  sb.onTable("orders", ok(cold));
  sb.onTable("webhook_events", ok([])); // retryStuckWebhookEvents select
  sb.onTable("webhook_events", ok(null)); // DEAD sweep
}

/** The recorded SELECTs against `orders` (the two scans). */
function scanCalls() {
  return sb.callsFor("orders").filter((c) => c.action === "select");
}

describe("payment reconciler — refunds are NOT automated", () => {
  it("never queries the refunds table or calls provider refund APIs", async () => {
    queueScans([], []);

    const result = await runPaymentReconciler();

    expect(result).toHaveProperty("resolvedOrders");
    expect(result).toHaveProperty("retriedWebhooks");
    expect(sb.callsFor("refunds").length).toBe(0);
    expect(rzpMock.refunds.fetch).not.toHaveBeenCalled();
  });

  it("applies a captured payment found on an uncertain order", async () => {
    queueScans([scanRow("o1", "AWAITING_PAYMENT", "order_RZP1")], []);
    rzpMock.orders.fetchPayments.mockResolvedValueOnce({ items: [captured("pay_1")] });
    sb.onRpc("apply_captured_payment", ok({ result: "FULFILLED" }));

    const result = await runPaymentReconciler();

    expect(result.resolvedOrders).toBe(1);
    expect(sb.rpcParams("apply_captured_payment")?.p_razorpay_payment_id).toBe("pay_1");
  });
});

/**
 * Hole 1: a sweeper moves orders out of the live states on a timer — the hold
 * reaper to EXPIRED, the base-pass self-heal to CANCELLED. A capture can still
 * land after that (late UPI collect, or a webhook lost through Razorpay's
 * whole retry window). Before 0013 nothing re-checked those orders, so the
 * money was held with nothing issued and nothing flagged.
 */
describe("payment reconciler — swept orders are still reconciled", () => {
  it("recovers a captured payment on an EXPIRED event order", async () => {
    queueScans([], [scanRow("o_exp", "EXPIRED", "order_LATE")]);
    rzpMock.orders.fetchPayments.mockResolvedValueOnce({ items: [captured("pay_late")] });
    // Hold is gone, so the SQL late-payment policy decides; here capacity was
    // reacquired and the order fulfilled.
    sb.onRpc("apply_captured_payment", ok({ result: "FULFILLED", orderId: "o_exp" }));

    const result = await runPaymentReconciler();

    expect(rzpMock.orders.fetchPayments).toHaveBeenCalledWith("order_LATE");
    expect(result.resolvedOrders).toBe(1);
    // Surfaced separately: a non-zero value means webhook delivery is unhealthy.
    expect(result.lateDiscoveries).toBe(1);
  });

  it("recovers a captured payment on a CANCELLED base-pass order", async () => {
    queueScans([], [scanRow("o_can", "CANCELLED", "order_CANCELLED")]);
    rzpMock.orders.fetchPayments.mockResolvedValueOnce({ items: [captured("pay_c")] });
    sb.onRpc("apply_captured_payment", ok({ result: "FULFILLED", orderId: "o_can" }));

    const result = await runPaymentReconciler();

    expect(result.resolvedOrders).toBe(1);
    expect(result.lateDiscoveries).toBe(1);
  });

  it("bounds cold re-checks so a dead order stops costing provider calls", async () => {
    queueScans([], []);
    await runPaymentReconciler({ coldMaxAttempts: 8 });

    const cold = scanCalls()[1];
    expect(cold.filters["reconcile_attempts:lt"]).toBe(8);
  });

  it("spends a cold attempt only when the provider actually answered", async () => {
    queueScans([], [scanRow("o_cold", "EXPIRED", "order_X")]);
    rzpMock.orders.fetchPayments.mockRejectedValueOnce(new Error("ETIMEDOUT"));

    const result = await runPaymentReconciler();

    expect(result.providerErrors).toBe(1);
    // Cursor advances (so the next cycle moves on) but the budget is intact:
    // a provider outage must not exhaust a cold order's attempts.
    expect(sb.rpcParams("mark_order_reconciled")?.p_spend_attempt).toBe(false);
  });

  it("leaves PAYMENT_REVIEW orders alone — already a human's problem", async () => {
    queueScans([], []);
    await runPaymentReconciler();

    for (const call of scanCalls()) {
      const states = call.filters["checkout_state:in"] as string[];
      expect(states).not.toContain("PAYMENT_REVIEW");
    }
  });
});

/**
 * Hole 2: the scan used a fixed LIMIT with no ORDER BY. Abandoned base-pass
 * orders accumulate in AWAITING_PAYMENT until that same user retries, so past
 * ~50 of them a genuinely paid order could sit outside the window forever.
 */
describe("payment reconciler — scan fairness", () => {
  it("orders both scans by the reconciliation cursor, never-checked first", async () => {
    queueScans([], []);
    await runPaymentReconciler();

    const calls = scanCalls();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const order = call.filters["$order"] as { col: string; nullsFirst?: boolean }[];
      expect(order?.[0]?.col).toBe("last_reconciled_at");
      expect(order?.[0]?.nullsFirst).toBe(true);
    }
  });

  it("advances the cursor for every order it checks", async () => {
    queueScans(
      [scanRow("o1", "AWAITING_PAYMENT", "order_A"), scanRow("o2", "AWAITING_PAYMENT", "order_B")],
      []
    );
    rzpMock.orders.fetchPayments.mockResolvedValue({ items: [] });

    await runPaymentReconciler();

    const stamped = sb
      .callsFor("mark_order_reconciled")
      .map((c) => c.params?.p_order_id);
    expect(stamped).toEqual(["o1", "o2"]);
  });

  it("applies separate batch limits to live and cold scans", async () => {
    queueScans([], []);
    await runPaymentReconciler({ liveBatch: 50, coldBatch: 25 });

    const calls = scanCalls();
    expect(calls[0].filters["$limit"]).toBe(50);
    expect(calls[1].filters["$limit"]).toBe(25);
  });

  it("skips orders with no provider order — nothing was ever payable", async () => {
    queueScans([scanRow("o_nomap", "PROVISIONING_PROVIDER", null)], []);

    const result = await runPaymentReconciler();

    expect(rzpMock.orders.fetchPayments).not.toHaveBeenCalled();
    expect(result.resolvedOrders).toBe(0);
  });
});

/**
 * Hole 4: `resolvedOrders++` used to count every apply_captured_payment
 * result, so a refund obligation looked identical to a success in the logs.
 */
describe("payment reconciler — outcome classification", () => {
  it("counts a refund obligation separately from a resolved order", async () => {
    queueScans([scanRow("o_ref", "AWAITING_PAYMENT", "order_R")], []);
    rzpMock.orders.fetchPayments.mockResolvedValueOnce({ items: [captured("pay_r")] });
    sb.onRpc(
      "apply_captured_payment",
      ok({ result: "REFUND_REQUIRED", reason: "late_payment" })
    );

    const result = await runPaymentReconciler();

    expect(result.refundRequired).toBe(1);
    expect(result.resolvedOrders).toBe(0);
  });

  it("counts an amount mismatch as needing attention, not as resolved", async () => {
    queueScans([scanRow("o_mm", "AWAITING_PAYMENT", "order_M")], []);
    rzpMock.orders.fetchPayments.mockResolvedValueOnce({ items: [captured("pay_m", 100)] });
    sb.onRpc("apply_captured_payment", ok({ result: "AMOUNT_MISMATCH" }));

    const result = await runPaymentReconciler();

    expect(result.amountMismatch).toBe(1);
    expect(result.resolvedOrders).toBe(0);
  });

  it("counts an orphan (mapping not yet persisted) without claiming success", async () => {
    queueScans([scanRow("o_orph", "PROVISIONING_PROVIDER", "order_O")], []);
    rzpMock.orders.fetchPayments.mockResolvedValueOnce({ items: [captured("pay_o")] });
    sb.onRpc("apply_captured_payment", ok({ result: "ORPHAN" }));

    const result = await runPaymentReconciler();

    expect(result.orphans).toBe(1);
    expect(result.resolvedOrders).toBe(0);
  });

  it("treats ALREADY_APPLIED as resolved (idempotent replay, not a failure)", async () => {
    queueScans([scanRow("o_dup", "AWAITING_PAYMENT", "order_D")], []);
    rzpMock.orders.fetchPayments.mockResolvedValueOnce({ items: [captured("pay_d")] });
    sb.onRpc("apply_captured_payment", ok({ result: "ALREADY_APPLIED" }));

    const result = await runPaymentReconciler();

    expect(result.resolvedOrders).toBe(1);
    expect(result.refundRequired).toBe(0);
  });
});

describe("payment reconciler — provider and DB failure handling", () => {
  it("ignores non-captured provider payments entirely", async () => {
    queueScans([scanRow("o_f", "AWAITING_PAYMENT", "order_F")], []);
    rzpMock.orders.fetchPayments.mockResolvedValueOnce({
      items: [
        { id: "pay_failed", status: "failed", amount: 20000, currency: "INR" },
        { id: "pay_created", status: "created", amount: 20000, currency: "INR" },
        // Auto-capture is enabled at order level, but an authorized payment is
        // money already debited. It must never fulfil on its own.
        { id: "pay_auth", status: "authorized", amount: 20000, currency: "INR" },
      ],
    });

    const result = await runPaymentReconciler();

    expect(sb.callsFor("apply_captured_payment").length).toBe(0);
    expect(result.resolvedOrders).toBe(0);
  });

  it("keeps going after one order's provider fetch fails", async () => {
    queueScans(
      [
        scanRow("o_bad", "AWAITING_PAYMENT", "order_BAD"),
        scanRow("o_good", "AWAITING_PAYMENT", "order_GOOD"),
      ],
      []
    );
    rzpMock.orders.fetchPayments
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce({ items: [captured("pay_ok")] });
    sb.onRpc("apply_captured_payment", ok({ result: "FULFILLED" }));

    const result = await runPaymentReconciler();

    expect(result.providerErrors).toBe(1);
    expect(result.resolvedOrders).toBe(1);
  });

  it("does not count an order as resolved when the apply RPC errors", async () => {
    queueScans([scanRow("o_err", "AWAITING_PAYMENT", "order_E")], []);
    rzpMock.orders.fetchPayments.mockResolvedValueOnce({ items: [captured("pay_e")] });
    sb.onRpc("apply_captured_payment", fail("deadlock detected", "40P01"));

    const result = await runPaymentReconciler();

    expect(result.resolvedOrders).toBe(0);
    expect(result.refundRequired).toBe(0);
  });

  it("survives a failed scan query without throwing", async () => {
    sb.onTable("orders", fail("connection terminated"));
    sb.onTable("orders", fail("connection terminated"));
    sb.onTable("webhook_events", ok([]));
    sb.onTable("webhook_events", ok(null));

    await expect(runPaymentReconciler()).resolves.toMatchObject({
      resolvedOrders: 0,
    });
  });

  it("applies only once when a provider order carries two captured payments", async () => {
    queueScans([scanRow("o_two", "AWAITING_PAYMENT", "order_TWO")], []);
    rzpMock.orders.fetchPayments.mockResolvedValueOnce({
      items: [captured("pay_1"), captured("pay_2")],
    });
    // The SQL function is at-most-once per order: the second capture cannot
    // create a second fulfillment, it reports the existing one.
    sb.onRpc("apply_captured_payment", ok({ result: "FULFILLED" }));
    sb.onRpc("apply_captured_payment", ok({ result: "ALREADY_APPLIED" }));

    const result = await runPaymentReconciler();

    expect(sb.callsFor("apply_captured_payment").length).toBe(2);
    expect(result.resolvedOrders).toBe(2); // both report settled, one fulfillment
  });

  it("waits out a grace period before checking a brand-new order", async () => {
    queueScans([], []);
    await runPaymentReconciler({ minAgeMs: 120_000 });

    const live = scanCalls()[0];
    const cutoff = new Date(String(live.filters["created_at:lt"])).getTime();
    // Recent orders are excluded so the browser callback and webhook can land
    // first instead of racing the reconciler.
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(119_000);
  });
});
