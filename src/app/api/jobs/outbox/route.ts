import type { NextRequest } from "next/server";
import { apiFromError, apiSuccess } from "@/lib/api";
import { readRawBody, verifyQstashSignature } from "@/lib/route-utils";
import { runOutboxDispatcher } from "@/workers/outbox-dispatcher";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/jobs/outbox — QStash wake for the outbox dispatcher.
 * Claims durable outbox jobs and performs their side effects idempotently.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readRawBody(req);
    await verifyQstashSignature(req, body);

    const result = await runOutboxDispatcher({ batchSize: 25 });
    return apiSuccess(req, result);
  } catch (err) {
    return apiFromError(req, err);
  }
}
