import type { NextRequest } from "next/server";
import { apiFromError, apiSuccess } from "@/lib/api";
import { readRawBody, verifyQstashSignature } from "@/lib/route-utils";
import { runExportWorker } from "@/workers/export-worker";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/jobs/exports — QStash wake for the export worker (plan §12.18).
 * Builds requested CSV exports from a consistent snapshot.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await readRawBody(req);
    await verifyQstashSignature(req, body);

    const result = await runExportWorker({ batchSize: 3 });
    return apiSuccess(req, result);
  } catch (err) {
    return apiFromError(req, err);
  }
}
