import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { readJsonBody } from "@/lib/route-utils";
import { teamJoinSchema } from "@/lib/validation/schemas";
import { requireUser } from "@/services/authz";
import { joinTeamByCode } from "@/services/team-service";

export const dynamic = "force-dynamic";

/** POST /api/teams/join — accept an invite code (plan §12.4). */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const ctx = await requireUser();
    await enforceRateLimit("team", `user:${ctx.userId}`, { failClosed: true });

    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = teamJoinSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid invite code");
    }

    const team = await joinTeamByCode(ctx.userId, parsed.data.inviteCode);
    return apiSuccess(req, { team });
  } catch (err) {
    return apiFromError(req, err);
  }
}
