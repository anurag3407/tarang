import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { requireUser } from "@/services/authz";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { fetchProfilesByUserId } from "@/lib/supabase/paginate";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/registrations — the caller's event registrations
 * (as owner or team member).
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requireUser();
    await enforceRateLimit("me", `user:${ctx.userId}`, { failClosed: false });
    const sb = createServiceRoleClient();

    // Registrations where the caller is a member (covers team members).
    const { data: memberships } = await sb
      .from("registration_members")
      .select("registration_id")
      .eq("user_id", ctx.userId)
      .limit(100);
    const regIds = (memberships ?? []).map((m) => m.registration_id);
    if (regIds.length === 0) {
      return apiSuccess(req, { registrations: [] });
    }

    const { data, error } = await sb
      .from("registrations")
      .select(
        `id, public_registration_code, team_name, registration_mode, state,
         confirmed_at, event_id,
         events ( name, slug, starts_at ),
         registration_members ( user_id, role )`
      )
      .in("id", regIds)
      .order("created_at", { ascending: false });
    if (error) return apiError(req, "INTERNAL", "Could not load registrations");

    const profiles = await fetchProfilesByUserId(
      sb,
      (data ?? []).flatMap((r) =>
        (r.registration_members ?? []).map((m: { user_id: string }) => m.user_id)
      )
    );

    const registrations = (data ?? []).map((r) => {
      const event = Array.isArray(r.events) ? r.events[0] : r.events;
      const members = (r.registration_members ?? []).map(
        (m: { user_id: string; role: string }) => ({
          displayName: profiles.get(m.user_id)?.display_name ?? null,
          role: m.role,
        })
      );
      return {
        id: r.id,
        publicRegistrationCode: r.public_registration_code,
        eventName: event?.name ?? "",
        eventSlug: event?.slug ?? "",
        eventStartsAt: event?.starts_at ?? null,
        teamName: r.team_name,
        registrationMode: r.registration_mode,
        state: r.state,
        confirmedAt: r.confirmed_at,
        members,
      };
    });
    return apiSuccess(req, { registrations });
  } catch (err) {
    return apiFromError(req, err);
  }
}
