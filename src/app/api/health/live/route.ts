import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/health/live — process liveness only (plan §15.8).
 *
 * Deliberately checks NO dependencies so a Redis/Supabase outage does not
 * trigger restart storms. no-store, tiny body.
 */
export async function GET() {
  return NextResponse.json(
    { status: "ok", uptimeSeconds: Math.round(process.uptime()) },
    {
      status: 200,
      headers: { "cache-control": "no-store" },
    }
  );
}
