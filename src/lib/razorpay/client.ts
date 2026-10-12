import "server-only";
import Razorpay from "razorpay";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env, razorpayConfigured } from "@/lib/env";

let instance: Razorpay | null = null;

/** Razorpay SDK singleton (plan §5.1). Test mode keys outside production. */
export function getRazorpay(): Razorpay | null {
  if (!razorpayConfigured()) return null;
  if (instance) return instance;
  const e = env();
  instance = new Razorpay({
    key_id: e.RAZORPAY_KEY_ID!,
    key_secret: e.RAZORPAY_KEY_SECRET!,
  });
  return instance;
}

/**
 * Deterministic receipt from the local order UUID (plan §9.4.1), <=40 chars.
 * Stable across retries so a lost response can be recovered by querying the
 * provider with the same receipt.
 */
export function receiptForOrder(localOrderId: string): string {
  const digest = createHash("sha1").update(localOrderId).digest("hex");
  return `pulse-${digest}`.slice(0, 40);
}

/** Verify the browser checkout callback HMAC (order_id|payment_id). */
export function verifyCheckoutSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string
): boolean {
  const e = env();
  if (!e.RAZORPAY_KEY_SECRET) return false;
  const expected = createHmac("sha256", e.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  return safeEqual(expected, signature);
}

/** Verify a webhook body against a secret (constant-time). */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Best-effort provider-side cancel of an unpaid Razorpay order (V-09).
 *
 * Kills a checkout modal left open on a locally-cancelled/expired order so
 * a late authorization fails provider-side. The node SDK does not expose the
 * cancel endpoint (2.9.8), so it is called through the instance's raw API
 * client. Idempotent: Razorpay answers 400 for orders that are already
 * paid/cancelled, which is exactly the terminal state we want.
 */
export async function cancelRazorpayOrder(
  razorpayOrderId: string
): Promise<string> {
  if (!razorpayConfigured()) return "skipped:not_configured";
  const rzp = getRazorpay()!;
  try {
    const res = await rzp.api.post<
      Record<string, never>,
      { status?: string }
    >({
      url: `/orders/${encodeURIComponent(razorpayOrderId)}/cancel`,
      data: {},
    });
    return `cancelled:${res.status ?? "unknown"}`;
  } catch (err) {
    const e = err as { statusCode?: number };
    if (e.statusCode === 400) {
      // Already paid or not cancellable — nothing left to do provider-side.
      return "noop:not_cancellable";
    }
    throw err;
  }
}
