import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp, hashIdentifier } from "@/lib/request-context";
import { readJsonBody } from "@/lib/route-utils";
import { verifyTurnstile } from "@/lib/turnstile";
import { authGuardSchema } from "@/lib/validation/schemas";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/guard (V-08) — app-layer throttle in front of the
 * browser→Supabase auth mutations (password sign-in/sign-up, magic link,
 * password reset, confirmation resend, Google OAuth start).
 *
 * GoTrue throttles internally, but this gives a per-IP + per-email ceiling
 * before the browser ever reaches Supabase, plus an optional Turnstile check
 * when a form supplies a widget token. The check fails open when Redis is
 * unavailable so a Redis blip never locks out legitimate sign-ins (mirrors
 * the auth/callback route).
 */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const body = await readJsonBody<Record<string, unknown>>(req, 4 * 1024);
    const parsed = authGuardSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid auth guard payload");
    }

    const ip = getClientIp(req);
    await enforceRateLimit("login", `ip:${hashIdentifier(ip ?? "unknown")}`);
    if (parsed.data.email) {
      await enforceRateLimit("login", `email:${hashIdentifier(parsed.data.email)}`);
    }

    // Turnstile is optional across the app: verify only when the form supplies
    // a token (a configured secret then demands a valid one). The rate limits
    // above are the primary application-layer control; requiring a widget
    // token unconditionally would lock out logins on deployments that have
    // not shipped the widget yet (V-08).
    const token = parsed.data.turnstileToken;
    if (token) {
      const turnstileOk = await verifyTurnstile(token, ip);
      if (!turnstileOk) {
        return apiError(req, "FORBIDDEN", "Bot check failed. Please try again.");
      }
    }

    return apiSuccess(req, { ok: true });
  } catch (err) {
    return apiFromError(req, err);
  }
}
