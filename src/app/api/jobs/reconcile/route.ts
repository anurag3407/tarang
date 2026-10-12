import type { NextRequest } from "next/server";
import { apiFromError, apiSuccess } from "@/lib/api";
import { readRawBody, verifyQstashSignature } from "@/lib/route-utils";
import { runPaymentReconciler } from "@/workers/payment-reconciler";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/jobs/reconcile — QStash wake for payment reconciliation
 * (plan §12.15). Resolves uncertain provider orders. Refunds are not
 * automated; REFUND_REQUIRED payments are handled manually by organizers.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readRawBody(req);
    await verifyQstashSignature(req, body);

    const result = await runPaymentReconciler();
    return apiSuccess(req, result);
  } catch (err) {
    return apiFromError(req, err);
  }
}
