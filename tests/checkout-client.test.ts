import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckout, isPayable } from "@/lib/checkout-client";
import type { CheckoutResult } from "@/domain/checkout";

function order(overrides: Partial<CheckoutResult> = {}): CheckoutResult {
  return {
    localOrderId: "o1",
    publicOrderCode: "PO-1",
    razorpayOrderId: "order_1",
    razorpayKeyId: "rzp_key",
    amountPaise: 20000,
    currency: "INR",
    expiresAt: null,
    status: "AWAITING_PAYMENT",
    ...overrides,
  };
}

function respond(...bodies: Array<{ status?: number; body: unknown }>) {
  const fetchMock = vi.fn();
  for (const b of bodies) {
    fetchMock.mockResolvedValueOnce({
      ok: (b.status ?? 200) < 400,
      json: async () => b.body,
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const keyOf = (call: unknown[]) =>
  ((call[1] as RequestInit).headers as Record<string, string>)["idempotency-key"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createCheckout", () => {
  it("returns a payable order on the first response", async () => {
    respond({ body: { ok: true, data: order() } });
    const res = await createCheckout("/api/x", {}, { current: "k1" });
    expect(res.ok && isPayable(res.data)).toBe(true);
  });

  it("renews the key once when the replayed order is dead", async () => {
    const fetchMock = respond(
      { body: { ok: true, data: order({ status: "EXPIRED" }) } },
      { body: { ok: true, data: order({ localOrderId: "o2" }) } }
    );
    const keyRef = { current: "old-key" };
    const res = await createCheckout("/api/x", {}, keyRef);
    expect(res.ok && res.data.localOrderId).toBe("o2");
    expect(keyOf(fetchMock.mock.calls[0])).toBe("old-key");
    expect(keyOf(fetchMock.mock.calls[1])).not.toBe("old-key");
    expect(keyRef.current).toBe(keyOf(fetchMock.mock.calls[1]));
  });

  it("replays the same key while the provider order is still being attached", async () => {
    vi.useFakeTimers();
    const fetchMock = respond(
      { body: { ok: true, data: order({ status: "PROVISIONING_PROVIDER", razorpayOrderId: null }) } },
      { body: { ok: true, data: order() } }
    );
    const pending = createCheckout("/api/x", {}, { current: "k1" });
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.ok && res.data.razorpayOrderId).toBe("order_1");
    expect(fetchMock.mock.calls.map(keyOf)).toEqual(["k1", "k1"]);
  });

  it("gives up without a payable order and keeps the key for a later resume", async () => {
    vi.useFakeTimers();
    const stuck = { body: { ok: true, data: order({ status: "PROVISIONING_PROVIDER", razorpayOrderId: null }) } };
    respond(stuck, stuck, stuck, stuck);
    const keyRef = { current: "k1" };
    const pending = createCheckout("/api/x", {}, keyRef);
    await vi.runAllTimersAsync();
    const res = await pending;
    expect(res.ok).toBe(false);
    expect(keyRef.current).toBe("k1");
  });

  it("passes API errors through with their code", async () => {
    respond({ status: 409, body: { ok: false, code: "PROFILE_INCOMPLETE", message: "Complete your profile" } });
    const res = await createCheckout("/api/x", {}, { current: "k1" });
    expect(res).toEqual({ ok: false, code: "PROFILE_INCOMPLETE", message: "Complete your profile" });
  });
});

describe("isPayable", () => {
  it("never treats an order without a Razorpay order id as payable", () => {
    expect(isPayable(order({ razorpayOrderId: null }))).toBe(false);
    expect(isPayable(order({ status: "FULFILLED" }))).toBe(false);
    expect(isPayable(order({ amountPaise: 0 }))).toBe(false);
  });
});
