import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  receiptForOrder,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/lib/razorpay/client";

const SECRET = process.env.RAZORPAY_KEY_SECRET!;

describe("razorpay signature verification", () => {
  it("accepts a valid browser checkout HMAC (order|payment)", () => {
    const orderId = "order_ABC123";
    const paymentId = "pay_XYZ789";
    const signature = createHmac("sha256", SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    expect(verifyCheckoutSignature(orderId, paymentId, signature)).toBe(true);
  });

  it("rejects a tampered payment id", () => {
    const orderId = "order_ABC123";
    const signature = createHmac("sha256", SECRET)
      .update(`${orderId}|pay_XYZ789`)
      .digest("hex");
    expect(verifyCheckoutSignature(orderId, "pay_EVIL00", signature)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const orderId = "order_ABC123";
    const paymentId = "pay_XYZ789";
    const signature = createHmac("sha256", "wrong_secret")
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    expect(verifyCheckoutSignature(orderId, paymentId, signature)).toBe(false);
  });

  it("rejects empty/garbage signatures without throwing", () => {
    expect(verifyCheckoutSignature("o", "p", "")).toBe(false);
    expect(verifyCheckoutSignature("o", "p", "zz")).toBe(false);
  });

  it("verifies webhook body HMAC", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: {} });
    const signature = createHmac("sha256", "whsec_test").update(body).digest("hex");
    expect(verifyWebhookSignature(body, signature, "whsec_test")).toBe(true);
    // One byte of body change must invalidate the signature.
    expect(verifyWebhookSignature(body + " ", signature, "whsec_test")).toBe(false);
    expect(verifyWebhookSignature(body, signature, "other_secret")).toBe(false);
  });
});

describe("deterministic receipts (plan §9.4.1)", () => {
  it("is stable for the same order id", () => {
    const id = "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d";
    expect(receiptForOrder(id)).toBe(receiptForOrder(id));
  });

  it("differs across order ids and stays <=40 chars", () => {
    const a = receiptForOrder("6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d");
    const b = receiptForOrder("7f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d");
    expect(a).not.toBe(b);
    expect(a.length).toBeLessThanOrEqual(40);
    expect(b.length).toBeLessThanOrEqual(40);
  });
});
