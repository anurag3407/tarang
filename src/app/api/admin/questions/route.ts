import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminRead } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/admin/questions — support ticket queue (plan §11.9). */
export async function GET(req: NextRequest) {
  try {
    await guardAdminRead(req, "support.read");
    const sb = await createServerSupabase();

    const status = req.nextUrl.searchParams.get("status");
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
    const pageSize = 20;

    let query = sb
      .from("support_questions")
      .select(
        "id, public_ticket_code, name, email, college, topic, question, status, resolution_note, created_at, resolved_at",
        { count: "exact" }
      )
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) return apiError(req, "INTERNAL", "Could not load questions");

    const questions = (data ?? []).map((q) => ({
      id: q.id,
      ticketCode: q.public_ticket_code,
      name: q.name,
      email: q.email,
      college: q.college,
      topic: q.topic,
      question: q.question,
      status: q.status,
      resolutionNote: q.resolution_note,
      createdAt: q.created_at,
      resolvedAt: q.resolved_at,
    }));
    return apiSuccess(req, { questions, page, pageSize, total: count ?? 0 });
  } catch (err) {
    return apiFromError(req, err);
  }
}
