import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getRazorpay } from "@/lib/razorpay/client";
import { logger } from "@/lib/logger";
import { retryStuckWebhookEvents } from "@/services/payment-service";

/**
 * Payment reconciler (plan §12.15).
 *
 * Resolves uncertain states so every captured payment ends up applied,
 * refund-required, or explicitly in review — none unclassified:
 *
 * 1. LIVE_STATES orders with a provider order: fetch provider state and apply
 *    if captured.
 * 2. COLD_STATES orders (a sweeper gave up on them) are re-checked a bounded
 *    number of times, because a captured payment can still land after the
 *    sweep — late UPI collect, or a webhook lost through Razorpay's entire
 *    retry window. Without this pass those payments are money we hold with
 *    nothing issued and nothing flagged.
 * 3. Webhook events stuck in RECEIVED/RETRY are re-processed (idempotent).
 *
 * Refunds are intentionally NOT automated: a payment left in
 * REFUND_REQUIRED / PAYMENT_REVIEW is a manual obligation the organizers
 * settle offline. Nothing here submits or reconciles provider refunds — but
 * every such obligation is counted and logged at warn level so it is visible.
 */

/** Still actively payable: always re-checked, never attempt-capped. */
const LIVE_STATES = ["PROVISIONING_PROVIDER", "AWAITING_PAYMENT"] as const;

/**
 * A sweeper already moved these on (hold reaper → EXPIRED, base-pass
 * self-heal → CANCELLED). Re-checked a bounded number of times so a late
 * capture is still discovered without unbounded provider traffic.
 */
const COLD_STATES = ["EXPIRED", "CANCELLED"] as const;

/**
 * PAYMENT_REVIEW is deliberately absent from both lists: it is already
 * flagged for a human and re-applying would not change the obligation.
 */

const DEFAULTS = {
  /** Orders scanned per cycle in each class. */
  liveBatch: 50,
  coldBatch: 25,
  /** Provider checks spent on a single cold order before giving up. */
  coldMaxAttempts: 8,
  /** Safety bound so a fresh deploy does not sweep the whole history. */
  coldLookbackDays: 30,
  /** Let the browser callback and webhook land first. */
  minAgeMs: 2 * 60_000,
} as const;

export interface ReconcileOutcome {
  /** FULFILLED or ALREADY_APPLIED — the order is settled correctly. */
  resolvedOrders: number;
  /**
   * Resolved from a COLD state: a payment that the webhook path missed
   * entirely. Non-zero means the webhook is unhealthy — investigate.
   */
  lateDiscoveries: number;
  /** Captured money that cannot be fulfilled — a manual refund obligation. */
  refundRequired: number;
  /** Provider amount/currency disagreed with the local order. */
  amountMismatch: number;
  /** Captured payment with no local mapping yet. */
  orphans: number;
  /** Event order whose hold row is missing entirely. */
  noHold: number;
  /** Provider fetch failures this cycle (retried next cycle). */
  providerErrors: number;
  retriedWebhooks: number;
}

function emptyOutcome(): ReconcileOutcome {
  return {
    resolvedOrders: 0,
    lateDiscoveries: 0,
    refundRequired: 0,
    amountMismatch: 0,
    orphans: 0,
    noHold: 0,
    providerErrors: 0,
    retriedWebhooks: 0,
  };
}

interface ScanRow {
  id: string;
  checkout_state: string;
  hold_expires_at: string | null;
  razorpay_orders?:
    | { razorpay_order_id: string }
    | { razorpay_order_id: string }[]
    | null;
}

/** PostgREST returns an embedded to-one either bare or as a single-element array. */
function providerOrderId(row: ScanRow): string | null {
  const mapping = Array.isArray(row.razorpay_orders)
    ? row.razorpay_orders[0]
    : row.razorpay_orders;
  return mapping?.razorpay_order_id ?? null;
}

/** Fold one apply_captured_payment result into the cycle tally. */
function tallyResult(
  outcome: ReconcileOutcome,
  result: string | undefined,
  cold: boolean
): void {
  switch (result) {
    case "FULFILLED":
    case "ALREADY_APPLIED":
      outcome.resolvedOrders++;
      if (cold) outcome.lateDiscoveries++;
      break;
    case "REFUND_REQUIRED":
      outcome.refundRequired++;
      break;
    case "AMOUNT_MISMATCH":
      outcome.amountMismatch++;
      break;
    case "ORPHAN":
      outcome.orphans++;
      break;
    case "NO_HOLD":
      outcome.noHold++;
      break;
    default:
      // NOT_CAPTURED / ORDER_NOT_FOUND: nothing owed, nothing to flag.
      break;
  }
}

export async function runPaymentReconciler(
  opts: Partial<typeof DEFAULTS> = {}
): Promise<ReconcileOutcome> {
  const cfg = { ...DEFAULTS, ...opts };
  const log = logger();
  const sb = createServiceRoleClient();
  const rzp = getRazorpay();
  const outcome = emptyOutcome();

  /**
   * Check one class of orders against the provider.
   *
   * Ordering by last_reconciled_at (nulls first) makes the scan a fair
   * round-robin: with a fixed limit and no ordering, abandoned orders can
   * permanently occupy the window and starve a genuinely paid one.
   */
  async function scan(
    states: readonly string[],
    batch: number,
    cold: boolean
  ): Promise<void> {
    let query = sb
      .from("orders")
      .select(
        "id, checkout_state, hold_expires_at, razorpay_orders ( razorpay_order_id )"
      )
      .in("checkout_state", states as string[])
      .lt("created_at", new Date(Date.now() - cfg.minAgeMs).toISOString());

    if (cold) {
      query = query
        .lt("reconcile_attempts", cfg.coldMaxAttempts)
        .gt(
          "created_at",
          new Date(
            Date.now() - cfg.coldLookbackDays * 24 * 60 * 60_000
          ).toISOString()
        );
    }

    const { data, error } = await query
      .order("last_reconciled_at", { ascending: true, nullsFirst: true })
      .limit(batch);

    if (error) {
      log.error({ err: error.message, cold }, "reconciler scan failed");
      return;
    }

    for (const order of (data ?? []) as ScanRow[]) {
      const razorpayOrderId = providerOrderId(order);
      // No provider order means nothing was ever payable.
      if (!razorpayOrderId || !rzp) continue;

      let providerAnswered = false;
      try {
        const payments = await rzp.orders.fetchPayments(razorpayOrderId);
        providerAnswered = true;

        for (const p of payments.items ?? []) {
          if (p.status !== "captured") continue;
          const { data: applied, error: applyErr } = await sb.rpc(
            "apply_captured_payment",
            {
              p_razorpay_payment_id: String(p.id),
              p_razorpay_order_id: razorpayOrderId,
              p_amount_paise: Number(p.amount ?? 0),
              p_currency: String(p.currency ?? "INR"),
              p_provider_status: "captured",
              p_provider_created_at: p.created_at
                ? new Date(Number(p.created_at) * 1000).toISOString()
                : null,
            }
          );
          if (applyErr) {
            log.error(
              { err: applyErr.message, orderId: order.id },
              "apply_captured_payment failed during reconciliation"
            );
            continue;
          }
          const result = (applied as { result?: string } | null)?.result;
          tallyResult(outcome, result, cold);

          if (cold && (result === "FULFILLED" || result === "ALREADY_APPLIED")) {
            log.warn(
              {
                orderId: order.id,
                state: order.checkout_state,
                paymentId: String(p.id),
                result,
              },
              "late capture recovered on a swept order — webhook delivery missed it"
            );
          }
          if (result === "REFUND_REQUIRED" || result === "AMOUNT_MISMATCH") {
            log.error(
              {
                orderId: order.id,
                paymentId: String(p.id),
                result,
              },
              "captured payment cannot be fulfilled — manual refund obligation"
            );
          }
        }
      } catch (err) {
        outcome.providerErrors++;
        log.warn(
          { err: err instanceof Error ? err.message : String(err), orderId: order.id },
          "reconcile fetch failed; will retry next cycle"
        );
      }

      // Always advance the cursor so the next cycle moves on to other orders;
      // only spend an attempt when the provider actually answered, so a
      // provider outage does not burn a cold order's budget. The increment
      // has to happen server-side — a read-modify-write from here would race
      // a concurrent worker.
      await sb.rpc("mark_order_reconciled", {
        p_order_id: order.id,
        p_spend_attempt: cold && providerAnswered,
      });
    }
  }

  await scan(LIVE_STATES, cfg.liveBatch, false);
  await scan(COLD_STATES, cfg.coldBatch, true);

  outcome.retriedWebhooks = await retryStuckWebhookEvents();

  const needsAttention =
    outcome.refundRequired > 0 ||
    outcome.amountMismatch > 0 ||
    outcome.lateDiscoveries > 0;

  if (needsAttention) {
    log.error(outcome, "reconciliation found payments needing manual attention");
  } else if (outcome.resolvedOrders > 0 || outcome.retriedWebhooks > 0) {
    log.info(outcome, "reconciliation cycle complete");
  }
  return outcome;
}
