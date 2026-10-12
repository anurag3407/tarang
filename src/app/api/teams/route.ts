import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { readJsonBody } from "@/lib/route-utils";
import { teamCreateSchema } from "@/lib/validation/schemas";
import { requireUser } from "@/services/authz";
import { createTeamDraft, listTeamDraftsForUser } from "@/services/team-service";

export const dynamic = "force-dynamic";

/** GET /api/teams — the caller's team drafts (dashboard). */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser();
    const teams = await listTeamDraftsForUser(ctx.userId);
    return apiSuccess(req, { teams });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/** POST /api/teams — create a team draft for an event (plan §12.4). */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const ctx = await requireUser();
    await enforceRateLimit("team", `user:${ctx.userId}`, { failClosed: true });

    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = teamCreateSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid team", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }

    const team = await createTeamDraft(
      ctx.userId,
      ctx.festivalId,
      parsed.data.eventId,
      parsed.data.teamName
    );
    return apiSuccess(req, { team }, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
