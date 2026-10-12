import type { NextRequest } from "next/server";
import { apiFromError, apiSuccess } from "@/lib/api";
import { readRawBody, verifyQstashSignature } from "@/lib/route-utils";
import { runHoldReaper } from "@/workers/hold-reaper";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/jobs/hold-reaper — QStash one-minute recovery wake (plan §12.9).
 *
 * The dedicated worker loop normally expires holds every 5–15s; this
 * endpoint is the safety net if that loop stops. Idempotent: the SQL
 * function uses FOR UPDATE SKIP LOCKED.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readRawBody(req);
    await verifyQstashSignature(req, body);

    const result = await runHoldReaper({ batchSize: 200 });
    return apiSuccess(req, result);
  } catch (err) {
    return apiFromError(req, err);
  }
}
