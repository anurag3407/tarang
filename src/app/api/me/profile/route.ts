import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { readJsonBody } from "@/lib/route-utils";
import { requireUser } from "@/services/authz";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

/** GET /api/me/profile — the caller's profile + completion state. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser();
    await enforceRateLimit("me", `user:${ctx.userId}`, { failClosed: false });
    const sb = createServiceRoleClient();
    const { data } = await sb
      .from("profiles")
      .select(
        "user_id, display_name, college_name, phone_e164, public_member_code, profile_completed_at, status"
      )
      .eq("user_id", ctx.userId)
      .maybeSingle();

    return apiSuccess(req, {
      profile: data
        ? {
            userId: data.user_id,
            displayName: data.display_name,
            collegeName: data.college_name,
            phoneE164: data.phone_e164,
            publicMemberCode: data.public_member_code,
            profileCompletedAt: data.profile_completed_at,
            status: data.status,
            complete: Boolean(data.profile_completed_at),
          }
        : { complete: false },
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}

const noControl = z.string().regex(/^[\P{C}]*$/u, "Control characters not allowed");

const profileSchema = z
  .object({
    displayName: noControl.trim().min(2).max(120),
    collegeName: noControl.trim().min(2).max(160),
    phoneE164: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/, "Enter a valid phone number with country code"),
    consent: z.literal(true),
  })
  .strict();

/**
 * PATCH /api/me/profile — complete profile (plan §11.3).
 * Captures required name/college/phone/consent before purchase.
 */
export async function PATCH(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const ctx = await requireUser();
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Please complete all fields", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const { displayName, collegeName, phoneE164 } = parsed.data;

    const sb = createServiceRoleClient();
    const { data, error } = await sb
      .from("profiles")
      .upsert(
        {
          user_id: ctx.userId,
          display_name: displayName,
          college_name: collegeName,
          phone_e164: phoneE164,
          consent_version: "v1",
          consented_at: new Date().toISOString(),
          profile_completed_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )
      .select("user_id, display_name, profile_completed_at")
      .single();
    if (error) {
      return apiError(req, "INTERNAL", "Could not save profile");
    }

    return apiSuccess(req, {
      profile: {
        userId: data.user_id,
        displayName: data.display_name,
        complete: Boolean(data.profile_completed_at),
      },
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
