import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { supabaseConfigured } from "@/lib/env";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp, hashIdentifier } from "@/lib/request-context";
import { readJsonBody } from "@/lib/route-utils";
import { supportQuestionSchema } from "@/lib/validation/schemas";
import { verifyTurnstile } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/questions — submit a support question (plan §11.9).
 *
 * Rate-limited by email hash and IP (20/hour, fail closed), Turnstile-gated,
 * Zod-validated. Returns only the random public ticket code.
 */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const body = await readJsonBody<Record<string, unknown>>(req, 16 * 1024);
    const parsed = supportQuestionSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Please check your submission", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const input = parsed.data;

    const ip = getClientIp(req);
    // Fail-closed limits on both keys (plan §10.4).
    await enforceRateLimit("ask", `email:${hashIdentifier(input.email)}`, {
      failClosed: true,
    });
    if (ip) {
      await enforceRateLimit("askIp", `ip:${hashIdentifier(ip)}`, { failClosed: true });
    }

    const turnstileOk = await verifyTurnstile(input.turnstileToken, ip);
    if (!turnstileOk) {
      return apiError(req, "FORBIDDEN", "Bot check failed. Please try again.");
    }

    // Submissions need the database; fail closed with a controlled 503.
    if (!supabaseConfigured()) {
      return apiError(
        req,
        "MAINTENANCE",
        "Submissions are temporarily unavailable. Please try again later."
      );
    }

    const sb = createServiceRoleClient();
    const { data, error } = await sb
      .from("support_questions")
      .insert({
        name: input.name,
        email: input.email,
        college: input.college || null,
        topic: input.topic,
        question: input.question,
        status: "OPEN",
      })
      .select("public_ticket_code")
      .single();
    if (error) {
      return apiError(req, "INTERNAL", "Could not submit your question");
    }

    return apiSuccess(
      req,
      { ticketCode: data.public_ticket_code as string },
      201
    );
  } catch (err) {
    return apiFromError(req, err);
  }
}
