import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminRead } from "@/lib/admin-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/registrations — paginated event registrations list.
 *
 * Scoped to festival events. Bounded page size; never loads records unbounded.
 * Supports search across code, team name, and participant profiles.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await guardAdminRead(req, "admin.access");
    const sb = createServiceRoleClient();

    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? "25") || 25)
    );
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const eventId = req.nextUrl.searchParams.get("eventId");
    const status = req.nextUrl.searchParams.get("status");

    let query = sb
      .from("registrations")
      .select(
        `
        id, public_registration_code, registration_mode, team_name, capacity_units,
        state, confirmed_at, created_at, owner_user_id,
        events!inner (
          id, name, slug, festival_id,
          categories ( name ),
          venues ( name )
        ),
        order_lines (
          id, line_amount_paise,
          orders ( id, public_order_code, checkout_state )
        ),
        registration_members ( role, user_id )
      `,
        { count: "exact" }
      )
      .eq("events.festival_id", ctx.festivalId)
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (eventId) {
      query = query.eq("event_id", eventId);
    }

    if (status && status !== "ALL") {
      query = query.eq("state", status);
    }

    const cleanQ = q.replace(/[,()"\\]/g, " ").trim();
    if (cleanQ) {
      const { data: matchedProfiles } = await sb
        .from("profiles")
        .select("user_id")
        .or(`display_name.ilike.%${cleanQ}%,phone_e164.ilike.%${cleanQ}%,college_name.ilike.%${cleanQ}%`)
        .limit(25);

      const matchedUserIds = (matchedProfiles ?? []).map((p) => p.user_id);
      if (matchedUserIds.length > 0) {
        query = query.or(
          `public_registration_code.ilike.%${cleanQ}%,team_name.ilike.%${cleanQ}%,owner_user_id.in.(${matchedUserIds.join(",")})`
        );
      } else {
        query = query.or(
          `public_registration_code.ilike.%${cleanQ}%,team_name.ilike.%${cleanQ}%`
        );
      }
    }

    const { data: rawRegs, error, count } = await query;
    if (error) {
      return apiError(req, "INTERNAL", `Could not load registrations: ${error.message}`);
    }

    // Collect all relevant user IDs for profiles & emails on this page
    const userIds = new Set<string>();
    for (const r of rawRegs ?? []) {
      if (r.owner_user_id) userIds.add(r.owner_user_id);
      for (const m of r.registration_members ?? []) {
        if (m.user_id) userIds.add(m.user_id);
      }
    }

    const userIdsArr = Array.from(userIds);
    const { data: profiles } =
      userIdsArr.length > 0
        ? await sb
            .from("profiles")
            .select("user_id, display_name, phone_e164, college_name, public_member_code")
            .in("user_id", userIdsArr)
        : { data: [] };

    const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p]));

    // Fetch auth emails concurrently
    const userEmailMap = new Map<string, string>();
    await Promise.all(
      userIdsArr.map(async (uid) => {
        try {
          const { data: u } = await sb.auth.admin.getUserById(uid);
          if (u?.user?.email) userEmailMap.set(uid, u.user.email);
        } catch {
          // ignore
        }
      })
    );

    const items = (rawRegs ?? []).map((r) => {
      const ev = Array.isArray(r.events) ? r.events[0] : r.events;
      const cat = ev?.categories ? (Array.isArray(ev.categories) ? ev.categories[0] : ev.categories) : null;
      const ven = ev?.venues ? (Array.isArray(ev.venues) ? ev.venues[0] : ev.venues) : null;
      const ol = Array.isArray(r.order_lines) ? r.order_lines[0] : r.order_lines;
      const ord = ol?.orders ? (Array.isArray(ol.orders) ? ol.orders[0] : ol.orders) : null;

      const ownerProfile = profileMap.get(r.owner_user_id);
      const ownerEmail = userEmailMap.get(r.owner_user_id) || "—";

      const members = (r.registration_members ?? []).map((m: { role: string; user_id: string }) => {
        const p = profileMap.get(m.user_id);
        const email = userEmailMap.get(m.user_id) || "—";
        return {
          role: m.role,
          userId: m.user_id,
          name: p?.display_name || "Participant",
          phone: p?.phone_e164 || "—",
          college: p?.college_name || "—",
          memberCode: p?.public_member_code || "",
          email,
        };
      });

      return {
        id: r.id,
        publicRegistrationCode: r.public_registration_code,
        registrationMode: r.registration_mode,
        teamName: r.team_name,
        capacityUnits: r.capacity_units,
        state: r.state,
        confirmedAt: r.confirmed_at,
        createdAt: r.created_at,
        event: {
          id: ev?.id,
          name: ev?.name || "Event",
          slug: ev?.slug || "",
          categoryName: cat?.name || "General",
          venueName: ven?.name || "TBD",
        },
        order: ord
          ? {
              id: ord.id,
              publicOrderCode: ord.public_order_code,
              checkoutState: ord.checkout_state,
              amountPaise: Number(ol?.line_amount_paise || 0),
            }
          : null,
        registrant: {
          name: ownerProfile?.display_name || "Participant",
          phone: ownerProfile?.phone_e164 || "—",
          college: ownerProfile?.college_name || "—",
          email: ownerEmail,
        },
        members,
      };
    });

    const total = count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return apiSuccess(req, {
      items,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
