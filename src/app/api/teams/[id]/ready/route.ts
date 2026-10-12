import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { requireUser } from "@/services/authz";
import { markTeamReady } from "@/services/team-service";

export const dynamic = "force-dynamic";

/**
 * POST /api/teams/:id/ready — validate size + base-pass readiness
 * (plan §12.4). Marks the draft READY so checkout can proceed.
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/teams/[id]/ready">
) {
  try {
    const { id } = await ctx.params;
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const auth = await requireUser();
    await enforceRateLimit("team", `user:${auth.userId}`, { failClosed: true });

    const team = await markTeamReady(auth.userId, id);
    return apiSuccess(req, { team });
  } catch (err) {
    return apiFromError(req, err);
  }
}
