import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminRead } from "@/lib/admin-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/payment-health — the two things that cannot be seen from the
 * order tables alone (plan §12.15).
 *
 *  1. Worker liveness. The reconciler is the safety net for every lost
 *     callback and lost webhook. When it stops, nothing errors — orders just
 *     quietly stop resolving. Only a heartbeat distinguishes that from a quiet
 *     sales day.
 *  2. The manual refund obligations. Refunds are deliberately not automated,
 *     so a captured payment that cannot be fulfilled is a task for a human.
 *     payment_review_queue is that work list.
 */

/** A worker missing this long is presumed down, not merely idle. */
const STALE_MULTIPLIER = 4;

/** Tick cadence per worker, mirroring CADENCE_MS in src/workers/main.ts. */
const EXPECTED_CADENCE_MS: Record<string, number> = {
  "hold-reaper": 10_000,
  outbox: 5_000,
  email: 10_000,
  reconcile: 60_000,
  exports: 30_000,
};

export async function GET(req: NextRequest) {
  try {
    await guardAdminRead(req, "payment.reconcile");
    const sb = createServiceRoleClient();

    const { data: beats, error: beatsErr } = await sb
      .from("worker_heartbeats")
      .select(
        "worker_name, last_started_at, last_success_at, last_error_at, last_error, consecutive_failures, runs"
      )
      .order("worker_name", { ascending: true });
    if (beatsErr) {
      return apiError(req, "INTERNAL", "Could not load worker heartbeats");
    }

    const now = Date.now();
    const workers = (beats ?? []).map((b) => {
      const lastSuccess = b.last_success_at
        ? new Date(b.last_success_at as string).getTime()
        : null;
      const cadence = EXPECTED_CADENCE_MS[b.worker_name as string] ?? 60_000;
      return {
        name: b.worker_name as string,
        lastStartedAt: b.last_started_at as string,
        lastSuccessAt: (b.last_success_at as string | null) ?? null,
        lastErrorAt: (b.last_error_at as string | null) ?? null,
        lastError: (b.last_error as string | null) ?? null,
        consecutiveFailures: Number(b.consecutive_failures ?? 0),
        runs: Number(b.runs ?? 0),
        // Never succeeded, or not within several expected cadences.
        stale:
          lastSuccess === null ||
          now - lastSuccess > cadence * STALE_MULTIPLIER,
      };
    });

    // A worker that has never registered a heartbeat is as bad as a stale one,
    // and it is invisible in the table — so surface it by absence.
    const missing = Object.keys(EXPECTED_CADENCE_MS).filter(
      (name) => !workers.some((w) => w.name === name)
    );

    const { data: queue, error: queueErr } = await sb
      .from("payment_review_queue")
      .select(
        "order_id, public_order_code, checkout_state, kind, razorpay_payment_id, amount_paise, currency, provider_status, disposition, provider_created_at, last_observed_at, order_created_at"
      )
      .limit(100);
    if (queueErr) {
      return apiError(req, "INTERNAL", "Could not load the payment review queue");
    }

    const review = (queue ?? []).map((r) => ({
      orderId: r.order_id as string,
      publicOrderCode: r.public_order_code as string,
      checkoutState: r.checkout_state as string,
      kind: r.kind as string,
      razorpayPaymentId: (r.razorpay_payment_id as string | null) ?? null,
      amountPaise: Number(r.amount_paise ?? 0),
      currency: (r.currency as string | null) ?? "INR",
      providerStatus: (r.provider_status as string | null) ?? null,
      disposition: (r.disposition as string | null) ?? null,
      providerCreatedAt: (r.provider_created_at as string | null) ?? null,
      lastObservedAt: (r.last_observed_at as string | null) ?? null,
      orderCreatedAt: (r.order_created_at as string | null) ?? null,
    }));

    return apiSuccess(req, {
      workers,
      missingWorkers: missing,
      workersUnhealthy:
        missing.length > 0 || workers.some((w) => w.stale || w.consecutiveFailures > 0),
      review,
      reviewCount: review.length,
      // What is actually owed, in money terms — the number to act on.
      refundRequiredPaise: review
        .filter((r) => r.disposition === "REFUND_REQUIRED")
        .reduce((sum, r) => sum + r.amountPaise, 0),
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
