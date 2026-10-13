import "server-only";
import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AppError } from "@/lib/errors";
import { getRazorpay, verifyCheckoutSignature } from "@/lib/razorpay/client";

/**
 * Payment service (plan §9.5, §12.7, §12.8).
 *
 * A browser "success" callback is only a hint: we verify the HMAC, then
 * fetch/verify captured provider state, and only then call the idempotent
 * apply_captured_payment. Webhooks are deduplicated by provider event id and
 * processed through the same function.
 */

export async function verifyAndApplyBrowserCallback(
  userId: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): Promise<{ result: string; orderId: string | null }> {
  // 1. Verify callback HMAC.
  if (!verifyCheckoutSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature)) {
    throw new AppError("SIGNATURE_INVALID", "Payment signature verification failed");
  }

  const sb = createServiceRoleClient();

  // 2. Verify the provider order maps to this user's local order.
  const { data: mapping, error: mapErr } = await sb
    .from("razorpay_orders")
    .select("local_order_id, expected_amount_paise, currency")
    .eq("razorpay_order_id", razorpayOrderId)
    .maybeSingle();
  if (mapErr || !mapping) {
    throw new AppError("NOT_FOUND", "Unknown payment order");
  }
  const { data: order } = await sb
    .from("orders")
    .select("id, purchaser_user_id, amount_paise, currency")
    .eq("id", mapping.local_order_id)
    .single();
  if (!order || order.purchaser_user_id !== userId) {
    throw new AppError("FORBIDDEN", "This payment does not belong to your account");
  }

  // 3. Fetch provider payment state (authoritative).
  let providerStatus = "unknown";
  let providerCreatedAt: string | null = null;
  let amount = Number(order.amount_paise);
  let currency = order.currency;
  const rzp = getRazorpay();
  if (rzp) {
    try {
      const payment = await rzp.payments.fetch(razorpayPaymentId);
      providerStatus = payment.status ?? "unknown";
      amount = Number(payment.amount ?? amount);
      if (payment.currency) {
        currency = String(payment.currency).toUpperCase();
      }
      if (payment.created_at) {
        providerCreatedAt = new Date(Number(payment.created_at) * 1000).toISOString();
      }
    } catch {
      // Provider unreachable: fall through to apply with captured assumption
      // only if the webhook has already recorded it. Otherwise return
      // processing and let reconciliation finish the job.
      providerStatus = "unknown";
    }
  }

  if (providerStatus === "captured" || providerStatus === "paid") {
    const { data, error } = await sb.rpc("apply_captured_payment", {
      p_razorpay_payment_id: razorpayPaymentId,
      p_razorpay_order_id: razorpayOrderId,
      p_amount_paise: amount,
      p_currency: currency,
      p_provider_status: "captured",
      p_provider_created_at: providerCreatedAt,
    });
    if (error) throw new AppError("INTERNAL", "Payment application failed");
    const res = data as { result: string; orderId?: string };

    if (res.result === "FULFILLED") {
      // Fulfillment enqueued the email, QR and Sheets outbox jobs in the same
      // transaction; kick the dispatcher so they run now, not on the next tick.
      const { runOutboxDispatcher } = await import("@/workers/outbox-dispatcher");
      void runOutboxDispatcher({ batchSize: 5 }).catch(() => {});
    }

    return { result: res.result, orderId: order.id };
  }

  // Not yet captured: return current local state; webhook/reconciler finishes.
  return { result: "PROCESSING", orderId: order.id };
}

/**
 * Process a durably-inserted Razorpay webhook event (plan §12.8).
 * Events are unordered snapshots; captured wins over failed.
 */
export async function processRazorpayWebhookEvent(webhookEventId: string): Promise<void> {
  const sb = createServiceRoleClient();
  const { data: event, error } = await sb
    .from("webhook_events")
    .select("id, event_type, raw_body, processing_state, attempts")
    .eq("id", webhookEventId)
    .single();
  if (error || !event) return;
  if (event.processing_state === "PROCESSED") return;

  await sb
    .from("webhook_events")
    .update({
      processing_state: "PROCESSING",
      attempts: (event.attempts ?? 0) + 1,
      // Stamps when THIS claim began, so a row whose handler dies is
      // distinguishable from one a worker is legitimately still running.
      processing_started_at: new Date().toISOString(),
    })
    .eq("id", webhookEventId);

  const body = event.raw_body as {
    payload?: {
      payment?: { entity?: Record<string, unknown> };
      order?: { entity?: Record<string, unknown> };
    };
  };

  try {
    const eventType = event.event_type as string;

    if (eventType === "payment.captured" || eventType === "payment.failed") {
      const payment = body.payload?.payment?.entity;
      if (payment) {
        const razorpayPaymentId = String(payment.id ?? "");
        const razorpayOrderId = String(payment.order_id ?? "");
        const amount = Number(payment.amount ?? 0);
        const currency = String(payment.currency ?? "INR");
        const status = String(payment.status ?? "unknown");
        const createdAt = payment.created_at
          ? new Date(Number(payment.created_at) * 1000).toISOString()
          : null;

        if (status === "captured") {
          const { data: applyData, error: applyErr } = await sb.rpc("apply_captured_payment", {
            p_razorpay_payment_id: razorpayPaymentId,
            p_razorpay_order_id: razorpayOrderId,
            p_amount_paise: amount,
            p_currency: currency,
            p_provider_status: "captured",
            p_provider_created_at: createdAt,
          });
          if (applyErr) throw new Error(`apply_captured_payment: ${applyErr.message}`);

          const fulfilledRes = applyData as { result?: string; orderId?: string };
          if (fulfilledRes?.result === "FULFILLED" && fulfilledRes.orderId) {
            const { runOutboxDispatcher } = await import("@/workers/outbox-dispatcher");
            void runOutboxDispatcher({ batchSize: 5 }).catch(() => {});
          }
        } else {
          // Record non-captured state without downgrading captured.
          const { error: upsertErr } = await sb.from("payments").upsert(
            {
              razorpay_payment_id: razorpayPaymentId,
              razorpay_order_id: razorpayOrderId,
              amount_paise: amount,
              currency,
              provider_status: status,
              provider_created_at: createdAt,
              last_observed_at: new Date().toISOString(),
            },
            { onConflict: "razorpay_payment_id", ignoreDuplicates: true }
          );
          // Retry rather than acknowledge: this row is the only local record
          // that the provider ever saw this payment id.
          if (upsertErr) throw new Error(`payments upsert: ${upsertErr.message}`);
        }
      }
    } else if (eventType === "order.paid") {
      const orderEntity = body.payload?.order?.entity;
      if (orderEntity) {
        // order.paid carries no payment entity, so the payment id has to come
        // from the provider. Both the lookup and the application are allowed
        // to throw: the outer catch marks this row RETRY, and
        // retryStuckWebhookEvents brings it back (bounded by maxAttempts,
        // then DEAD). Acknowledging here instead would discard the event and
        // leave the order-scan as the only recovery — which does not cover an
        // order outside the reconciler's state list or lookback window.
        const razorpayOrderId = String(orderEntity.id ?? "");
        const rzp = getRazorpay();
        if (rzp) {
          const payments = await rzp.orders.fetchPayments(razorpayOrderId);
          const items = payments.items ?? [];
          for (const p of items) {
            if (p.status === "captured") {
              const { data: applyData, error: applyErr } = await sb.rpc(
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
                throw new Error(`apply_captured_payment: ${applyErr.message}`);
              }

              const fulfilledRes = applyData as { result?: string; orderId?: string };
              if (fulfilledRes?.result === "FULFILLED" && fulfilledRes.orderId) {
                const { runOutboxDispatcher } = await import("@/workers/outbox-dispatcher");
                void runOutboxDispatcher({ batchSize: 5 }).catch(() => {});
              }
            }
          }
        }
      }
    }
    // Refund webhooks are intentionally ignored: refunds are not automated.
    // A payment left in REFUND_REQUIRED / PAYMENT_REVIEW is a manual
    // obligation the organizers settle offline (contact-based refunds).

    await sb
      .from("webhook_events")
      .update({ processing_state: "PROCESSED", processed_at: new Date().toISOString() })
      .eq("id", webhookEventId);
  } catch (err) {
    await sb
      .from("webhook_events")
      .update({
        processing_state: "RETRY",
        last_error: String(err instanceof Error ? err.message : err).slice(0, 2000),
      })
      .eq("id", webhookEventId);
    throw err;
  }
}

export function bodyHash(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

/**
 * Re-process webhook events that no one owns any more (plan §12.8).
 *
 * Two distinct strandings, both recovered here:
 *
 *  1. RECEIVED/RETRY — the route processes asynchronously via after(); if that
 *     fails (transient DB/provider error) the row is left behind with no other
 *     consumer.
 *  2. PROCESSING — the handler claimed the row and then died: a deploy mid
 *     flight, an OOM kill, a crashed web process. Razorpay already has its
 *     2xx, so it will never redeliver. Nothing else in the system looks at
 *     this state, so before this pass such a row was stranded permanently.
 *     Staleness is judged from processing_started_at, so a row a concurrent
 *     worker is legitimately still running is left alone.
 *
 * The reconciler calls this every cycle. Processing is idempotent (deduped by
 * provider event id; apply_captured_payment is at-most-once), and attempts are
 * bounded so poison payloads eventually go DEAD.
 */
export async function retryStuckWebhookEvents(opts: {
  batchSize?: number;
  maxAttempts?: number;
  /** How long a PROCESSING claim may live before its owner is presumed dead. */
  staleProcessingMs?: number;
} = {}): Promise<number> {
  const sb = createServiceRoleClient();
  const batchSize = opts.batchSize ?? 20;
  const maxAttempts = opts.maxAttempts ?? 10;
  const staleProcessingMs = opts.staleProcessingMs ?? 5 * 60_000;

  const ids: string[] = [];

  const { data: stuck, error } = await sb
    .from("webhook_events")
    .select("id")
    .in("processing_state", ["RECEIVED", "RETRY"])
    .lt("attempts", maxAttempts)
    // Give the in-flight after() handler time to finish before retrying.
    .lt("received_at", new Date(Date.now() - 60_000).toISOString())
    .order("received_at", { ascending: true })
    .limit(batchSize);
  if (error) {
    const { logger } = await import("@/lib/logger");
    logger().error({ err: error.message }, "reconciler failed to query stuck webhooks");
  } else {
    for (const row of stuck ?? []) ids.push(row.id as string);
  }

  // Abandoned claims. The stamp is written in the same statement that sets
  // PROCESSING, and 0018 backfills pre-existing rows, so a PROCESSING row
  // always carries a claim time — no null branch needed here.
  const staleBefore = new Date(Date.now() - staleProcessingMs).toISOString();
  const { data: abandoned, error: abandonedErr } = await sb
    .from("webhook_events")
    .select("id")
    .eq("processing_state", "PROCESSING")
    .lt("attempts", maxAttempts)
    .lt("processing_started_at", staleBefore)
    .order("processing_started_at", { ascending: true })
    .limit(batchSize);
  if (abandonedErr) {
    const { logger } = await import("@/lib/logger");
    logger().error(
      { err: abandonedErr.message },
      "reconciler failed to query abandoned webhook claims"
    );
  } else {
    for (const row of abandoned ?? []) ids.push(row.id as string);
  }

  if (error && abandonedErr) return 0;

  let retried = 0;
  for (const id of ids) {
    try {
      await processRazorpayWebhookEvent(id);
      retried++;
    } catch {
      // processRazorpayWebhookEvent already recorded RETRY + last_error;
      // the next cycle tries again until maxAttempts, then we mark DEAD.
    }
  }

  // Poison payloads: stop retrying after maxAttempts. PROCESSING is included
  // so a row that dies mid-handler every time still reaches a terminal state
  // instead of being reclaimed forever.
  await sb
    .from("webhook_events")
    .update({ processing_state: "DEAD" })
    .in("processing_state", ["RECEIVED", "RETRY", "PROCESSING"])
    .gte("attempts", maxAttempts);

  return retried;
}
