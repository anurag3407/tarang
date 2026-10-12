import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead } from "@/lib/admin-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readJsonBody } from "@/lib/route-utils";
import { enforceRateLimit } from "@/lib/redis/rate-limits";

export const dynamic = "force-dynamic";

const EXPORT_TYPES = [
  "EVENT_REGISTRATIONS",
  "ROSTER",
  "FINANCE_LEDGER",
  "SCAN_HISTORY",
] as const;

const requestSchema = z
  .object({
    exportType: z.enum(EXPORT_TYPES),
    eventId: z.string().uuid().optional(),
  })
  .strict();

/** GET /api/admin/exports — list the caller's export jobs. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await guardAdminRead(req, "registration.export");
    const sb = createServiceRoleClient();
    const { data, error } = await sb
      .from("export_jobs")
      .select(
        "id, export_type, state, row_count, as_of, expires_at, error, created_at, completed_at"
      )
      .eq("festival_id", ctx.festivalId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return apiError(req, "INTERNAL", "Could not load exports");

    const exports = (data ?? []).map((e) => ({
      id: e.id,
      exportType: e.export_type,
      state: e.state,
      rowCount: e.row_count,
      asOf: e.as_of,
      expiresAt: e.expires_at,
      error: e.error,
      createdAt: e.created_at,
      completedAt: e.completed_at,
    }));
    return apiSuccess(req, { exports });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/**
 * POST /api/admin/exports — request a consistent CSV export (plan §12.17).
 * Rate-limited 3/hour (fail closed). The export worker builds it from a
 * single snapshot; the file is downloadable once COMPLETED.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await guardAdminMutation(req, "registration.export");
    await enforceRateLimit("export", `user:${ctx.userId}`, { failClosed: true });

    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid export request");
    }

    // FINANCE_LEDGER additionally requires finance.read.
    if (parsed.data.exportType === "FINANCE_LEDGER") {
      await guardAdminMutation(req, "finance.read");
    }

    const sb = createServiceRoleClient();

    // An eventId filter must belong to this festival; otherwise the worker
    // would build an export mixing another festival's rows (V: export
    // isolation).
    if (parsed.data.eventId) {
      const { data: event, error: eventError } = await sb
        .from("events")
        .select("id")
        .eq("id", parsed.data.eventId)
        .eq("festival_id", ctx.festivalId)
        .maybeSingle();
      if (eventError || !event) {
        return apiError(req, "NOT_FOUND", "Event not found for this festival");
      }
    }

    const { data: job, error } = await sb
      .from("export_jobs")
      .insert({
        festival_id: ctx.festivalId,
        requested_by: ctx.userId,
        export_type: parsed.data.exportType,
        filter_snapshot: parsed.data.eventId
          ? { eventId: parsed.data.eventId }
          : {},
        state: "REQUESTED",
        expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) {
      return apiError(req, "INTERNAL", "Could not create export job");
    }

    return apiSuccess(req, { exportId: job.id, state: "REQUESTED" }, 202);
  } catch (err) {
    return apiFromError(req, err);
  }
}
