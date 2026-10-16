import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { requireUser } from "@/services/authz";
import { rotateInviteCode } from "@/services/team-service";
import { requireUuid } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/**
 * POST /api/teams/:id/invitations — generate/rotate the invite code
 * (plan §12.4). The plaintext code is returned exactly once; only its hash
 * is stored.
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/teams/[id]/invitations">
) {
  try {
    const id = requireUuid((await ctx.params).id, "Team");
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const auth = await requireUser();
    await enforceRateLimit("team", `user:${auth.userId}`, { failClosed: true });

    const { inviteCode } = await rotateInviteCode(auth.userId, id);
    return apiSuccess(req, { inviteCode });
  } catch (err) {
    return apiFromError(req, err);
  }
}
