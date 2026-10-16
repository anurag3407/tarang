import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { rupeesToPaise, toPaise } from "@/lib/money";
import { readJsonBody } from "@/lib/route-utils";
import { eventAdminSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/events — paginated admin event list (plan §11.6).
 * Bounded page size; never loads all records unbounded.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await guardAdminRead(req, "content.event.read");
    const sb = await createServerSupabase();

    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? "1") || 1);
    const pageSize = Math.min(
      50,
      Math.max(1, Number(req.nextUrl.searchParams.get("pageSize") ?? "20") || 20)
    );
    const search = (req.nextUrl.searchParams.get("q") ?? "").trim();
    const status = req.nextUrl.searchParams.get("status");

    let query = sb
      .from("events")
      .select(
        `id, slug, name, status, sales_state, featured, image_url, version, starts_at,
         registration_mode, capacity_basis, price_basis,
         current_price_version_id,
         categories ( name ),
         event_inventory ( capacity_units, held_units, confirmed_units )`,
        { count: "exact" }
      )
      .eq("festival_id", ctx.festivalId)
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (search) query = query.ilike("name", `%${search}%`);
    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) return apiError(req, "INTERNAL", "Could not load events");

    const priceIds = (data ?? [])
      .map((e) => e.current_price_version_id)
      .filter(Boolean);
    const prices = new Map<string, number>();
    if (priceIds.length > 0) {
      const { data: pv } = await sb
        .from("event_price_versions")
        .select("id, unit_amount_paise")
        .in("id", priceIds);
      for (const row of pv ?? []) prices.set(row.id, toPaise(row.unit_amount_paise));
    }

    const events = (data ?? []).map((e) => {
      const cat = Array.isArray(e.categories) ? e.categories[0] : e.categories;
      const inv = Array.isArray(e.event_inventory)
        ? e.event_inventory[0]
        : e.event_inventory;
      return {
        id: e.id,
        slug: e.slug,
        name: e.name,
        status: e.status,
        salesState: e.sales_state,
        featured: e.featured,
        imageUrl: e.image_url ?? null,
        version: e.version,
        startsAt: e.starts_at,
        registrationMode: e.registration_mode,
        capacityBasis: e.capacity_basis,
        priceBasis: e.price_basis,
        categoryName: cat?.name ?? "",
        amountPaise: prices.get(e.current_price_version_id) ?? 0,
        inventory: inv
          ? {
              capacityUnits: inv.capacity_units,
              heldUnits: inv.held_units,
              confirmedUnits: inv.confirmed_units,
            }
          : null,
      };
    });

    const adminSb = createServiceRoleClient();

    let [{ data: categories }, { data: venues }] = await Promise.all([
      adminSb
        .from("categories")
        .select("id, name, slug")
        .eq("festival_id", ctx.festivalId)
        .order("sort_order", { ascending: true }),
      adminSb
        .from("venues")
        .select("id, name, short_name")
        .eq("festival_id", ctx.festivalId)
        .order("name", { ascending: true }),
    ]);

    // If categories table has no entries for this festival, auto-seed defaults
    if (!categories || categories.length === 0) {
      const defaultCats = [
        { festival_id: ctx.festivalId, slug: "music", name: "Music", tagline: "Bands, vocals, acoustics & beats", icon_key: "music", color_key: "accent", sort_order: 1, is_active: true },
        { festival_id: ctx.festivalId, slug: "dance", name: "Dance", tagline: "Solo, duet, street & crew battles", icon_key: "activity", color_key: "secondary", sort_order: 2, is_active: true },
        { festival_id: ctx.festivalId, slug: "drama", name: "Dramatics", tagline: "Stage plays, street theatre & workshops", icon_key: "film", color_key: "muted", sort_order: 3, is_active: true },
        { festival_id: ctx.festivalId, slug: "arts", name: "Fine Arts", tagline: "Painting, sketching, digital art & crafts", icon_key: "palette", color_key: "white", sort_order: 4, is_active: true },
        { festival_id: ctx.festivalId, slug: "literary", name: "Literary", tagline: "Debate, quiz, poetry & creative writing", icon_key: "book-open", color_key: "accent", sort_order: 5, is_active: true },
        { festival_id: ctx.festivalId, slug: "sports", name: "Sports", tagline: "Cricket, football, badminton, athletics & gaming", icon_key: "trophy", color_key: "secondary", sort_order: 6, is_active: true },
        { festival_id: ctx.festivalId, slug: "medsci", name: "Tech & Quiz", tagline: "Quizzing, robotics, hackathons & tech showcases", icon_key: "cross", color_key: "muted", sort_order: 7, is_active: true },
        { festival_id: ctx.festivalId, slug: "informal", name: "Informals", tagline: "Fun games, scavenger hunts & casual contests", icon_key: "sparkles", color_key: "white", sort_order: 8, is_active: true },
      ];
      const { data: seededCats } = await adminSb
        .from("categories")
        .upsert(defaultCats, { onConflict: "festival_id,slug" })
        .select("id, name, slug")
        .order("sort_order", { ascending: true });
      if (seededCats && seededCats.length > 0) {
        categories = seededCats;
      }
    }

    // If venues table has no entries for this festival, auto-seed defaults
    if (!venues || venues.length === 0) {
      const defaultVenues = [
        { festival_id: ctx.festivalId, name: "Main Stage", short_name: "Main Stage", description: "Open-air stage for flagship events and pronites", is_active: true },
        { festival_id: ctx.festivalId, name: "Auditorium", short_name: "Audi", description: "Main indoor air-conditioned auditorium", is_active: true },
        { festival_id: ctx.festivalId, name: "LT 1 (Lecture Theatre 1)", short_name: "LT 1", description: "Indoor tiered hall for quizzes and academic events", is_active: true },
        { festival_id: ctx.festivalId, name: "LT 2 (Lecture Theatre 2)", short_name: "LT 2", description: "Indoor tiered hall for literary competitions", is_active: true },
        { festival_id: ctx.festivalId, name: "Sports Ground", short_name: "Ground", description: "Outdoor sports complex and athletic field", is_active: true },
        { festival_id: ctx.festivalId, name: "Registration Desk", short_name: "Reg Desk", description: "Central registration and help desk", is_active: true },
      ];
      const { data: seededVenues } = await adminSb
        .from("venues")
        .upsert(defaultVenues, { onConflict: "festival_id,name" })
        .select("id, name, short_name")
        .order("name", { ascending: true });
      if (seededVenues && seededVenues.length > 0) {
        venues = seededVenues;
      }
    }

    return apiSuccess(req, {
      events,
      page,
      pageSize,
      total: count ?? 0,
      categories,
      venues,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/**
 * POST /api/admin/events — create an event (plan §11.6).
 *
 * Runs admin_upsert_event on the caller's session so the SQL permission
 * check and audit actor resolve to the staff user. Price arrives as rupees
 * from the form; the server converts to integer paise.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await guardAdminMutation(req, "content.event.write");
    const body = await readJsonBody<Record<string, unknown>>(req, 128 * 1024);
    const parsed = eventAdminSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid event", {
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }
    const input = parsed.data;

    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("admin_upsert_event", {
      p_event_id: null,
      p_festival_id: ctx.festivalId,
      p_slug: input.slug,
      p_name: input.name,
      p_short_description: input.shortDescription,
      p_description: input.description,
      p_rules_markdown: input.rulesMarkdown,
      p_category_id: input.categoryId,
      p_venue_id: input.venueId,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_include_in_schedule: input.includeInSchedule,
      p_is_night_event: input.isNightEvent,
      p_registration_mode: input.registrationMode,
      p_capacity_basis: input.capacityBasis,
      p_price_basis: input.priceBasis,
      p_min_team_size: input.minTeamSize,
      p_max_team_size: input.maxTeamSize,
      p_capacity_units: input.capacityUnits,
      p_price_paise: rupeesToPaise(input.priceRupees),
      p_prize_pool_text: input.prizePoolText,
      p_registration_opens_at: input.registrationOpensAt,
      p_registration_closes_at: input.registrationClosesAt,
      p_featured: input.featured,
      p_expected_version: input.version,
      p_image_url: input.imageUrl ?? null,
    });
    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(ctx.festivalId, ["events", "schedule"]);
    return apiSuccess(req, { event: data }, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
