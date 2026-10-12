import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { apiError, apiFromError } from "@/lib/api";
import { requirePermission } from "@/services/authz";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

const EXPORT_FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.csv$/;
const exportDir = () => process.env.EXPORT_DIR ?? path.join(process.cwd(), ".exports");

/**
 * GET /api/admin/exports/:id/download — stream a completed CSV.
 * Requires registration.export (or finance.read for finance ledgers).
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/exports/[id]/download">
) {
  try {
    const { id } = await ctx.params;
    const auth = await requirePermission("registration.export");

    const sb = createServiceRoleClient();
    // Festival-scoped: an export job from another festival is indistinguishable
    // from a nonexistent one (V: export isolation).
    const { data: job, error } = await sb
      .from("export_jobs")
      .select("id, export_type, state, storage_object_path, expires_at")
      .eq("id", id)
      .eq("festival_id", auth.festivalId)
      .maybeSingle();
    if (error || !job) return apiError(req, "NOT_FOUND", "Export not found");

    if (job.export_type === "FINANCE_LEDGER") {
      await requirePermission("finance.read");
    }
    if (job.state !== "COMPLETED" || !job.storage_object_path) {
      return apiError(req, "CONFLICT", "Export is not ready for download");
    }
    if (job.expires_at && new Date(job.expires_at) < new Date()) {
      return apiError(req, "CONFLICT", "Export has expired — request a new one");
    }

    // Only ever serve files the worker itself wrote: the path must resolve
    // inside EXPORT_DIR and the basename must be "<job uuid>.csv".
    const resolved = path.resolve(job.storage_object_path);
    const root = path.resolve(exportDir());
    if (
      !resolved.startsWith(root + path.sep) ||
      !EXPORT_FILE_NAME.test(path.basename(resolved))
    ) {
      return apiError(req, "FORBIDDEN", "Export path rejected");
    }

    const csv = await readFile(resolved, "utf8");
    return new NextResponse(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${job.export_type.toLowerCase()}-${job.id}.csv"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
