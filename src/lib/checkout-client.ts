import type { CheckoutResult } from "@/domain/checkout";

/**
 * Browser-side checkout creation shared by the pass, event and merchandise
 * flows.
 *
 * The idempotency key lives in the caller's ref and is reused on every retry,
 * so a second click resumes the same order instead of opening a new one. The
 * key is renewed only when the replayed order is known dead (EXPIRED /
 * CANCELLED / REFUNDED), and a replayed order still waiting for its Razorpay order is
 * retried a few times — the server re-attempts provisioning on replay.
 *
 * A Razorpay modal must never be opened without an order id: Razorpay would
 * then take a standalone payment linked to nothing. Use isPayable() first.
 */

export type CheckoutResponse =
  | { ok: true; data: CheckoutResult }
  | { ok: false; code: string; message: string };

const DEAD_STATES = new Set(["EXPIRED", "CANCELLED", "REFUNDED"]);
const MAX_ATTEMPTS = 4;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createCheckout(
  url: string,
  body: unknown,
  keyRef: { current: string }
): Promise<CheckoutResponse> {
  let renewed = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    let json: { ok?: boolean; code?: string; message?: string; data?: CheckoutResult } | null;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": keyRef.current },
        body: JSON.stringify(body),
      });
      json = await res.json().catch(() => null);
    } catch {
      return { ok: false, code: "NETWORK", message: "Network error. Please check your connection and retry." };
    }
    if (!res.ok || !json?.ok || !json.data) {
      return {
        ok: false,
        code: json?.code ?? "INTERNAL",
        message: json?.message ?? "Checkout failed. Please retry.",
      };
    }

    const data = json.data;
    if (DEAD_STATES.has(data.status) && !renewed) {
      // The key replayed an order that has since expired: start a fresh one.
      keyRef.current = crypto.randomUUID();
      renewed = true;
      continue;
    }
    if (data.status === "PROVISIONING_PROVIDER" && !data.razorpayOrderId && data.amountPaise > 0) {
      if (attempt < MAX_ATTEMPTS - 1) await sleep(1500 * (attempt + 1));
      continue;
    }
    return { ok: true, data };
  }
  return {
    ok: false,
    code: "UPSTREAM_ERROR",
    message: "The payment gateway is busy. Please try again in a moment — your order is kept.",
  };
}

/** True when the order can be paid in a Razorpay modal right now. */
export function isPayable(data: CheckoutResult): boolean {
  return (
    data.status === "AWAITING_PAYMENT" &&
    Boolean(data.razorpayOrderId) &&
    Boolean(data.razorpayKeyId) &&
    data.amountPaise > 0
  );
}
