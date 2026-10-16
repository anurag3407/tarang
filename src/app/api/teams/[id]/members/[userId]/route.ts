import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { isAllowedOrigin } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { requireUser } from "@/services/authz";
import { removeTeamMember } from "@/services/team-service";
import { requireUuid } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/teams/:id/members/:userId — captain removes a member before
 * checkout (plan §12.4). The captain cannot remove themselves.
 */
export async function DELETE(
  req: NextRequest,
  ctx: RouteContext<"/api/teams/[id]/members/[userId]">
) {
  try {
    const params = await ctx.params;
    const id = requireUuid(params.id, "Team");
    const userId = requireUuid(params.userId, "Member");
    if (!isAllowedOrigin(req)) {
      return apiError(req, "BAD_REQUEST", "ORIGIN_NOT_ALLOWED");
    }

    const auth = await requireUser();
    await enforceRateLimit("team", `user:${auth.userId}`, { failClosed: true });

    await removeTeamMember(auth.userId, id, userId);
    return apiSuccess(req, { removed: userId });
  } catch (err) {
    return apiFromError(req, err);
  }
}
