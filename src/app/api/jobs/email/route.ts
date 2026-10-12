import type { NextRequest } from "next/server";
import { apiFromError, apiSuccess } from "@/lib/api";
import { readRawBody, verifyQstashSignature } from "@/lib/route-utils";
import { runEmailDispatcher } from "@/workers/outbox-dispatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/jobs/email — QStash wake for the email worker (plan §13.4).
 * Claims email_jobs leases and submits to Resend with stable idempotency.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readRawBody(req);
    await verifyQstashSignature(req, body);

    const result = await runEmailDispatcher({ batchSize: 10 });
    return apiSuccess(req, result);
  } catch (err) {
    return apiFromError(req, err);
  }
}
