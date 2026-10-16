import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { rupeesToPaise, toPaise } from "@/lib/money";
import { readJsonBody, requireUuid } from "@/lib/route-utils";
import { eventAdminSchema } from "@/lib/validation/schemas";
import { invalidateAvailability, invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/** GET /api/admin/events/:id — full event record for editing. */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/events/[id]">
) {
  try {
    const id = requireUuid((await ctx.params).id, "Event");
    await guardAdminRead(req, "content.event.read");
    const sb = await createServerSupabase();

    const { data: e, error } = await sb
      .from("events")
      .select(
        `id, slug, name, short_description, description, rules_markdown,
         category_id, venue_id, starts_at, ends_at, is_night_event,
         registration_mode, capacity_basis, price_basis, min_team_size,
         max_team_size, prize_pool_text, featured, image_url, status, sales_state,
         registration_opens_at, registration_closes_at, version,
         current_price_version_id,
         event_inventory ( capacity_units, held_units, confirmed_units )`
      )
      .eq("id", id)
      .maybeSingle();
    if (error || !e) return apiError(req, "NOT_FOUND", "Event not found");

    let amountPaise = 0;
    if (e.current_price_version_id) {
      const { data: pv } = await sb
        .from("event_price_versions")
        .select("unit_amount_paise")
        .eq("id", e.current_price_version_id)
        .maybeSingle();
      amountPaise = toPaise(pv?.unit_amount_paise);
    }
    const inv = Array.isArray(e.event_inventory)
      ? e.event_inventory[0]
      : e.event_inventory;

    return apiSuccess(req, {
      event: {
        id: e.id,
        slug: e.slug,
        name: e.name,
        shortDescription: e.short_description,
        description: e.description,
        rulesMarkdown: e.rules_markdown,
        categoryId: e.category_id,
        venueId: e.venue_id,
        startsAt: e.starts_at,
        endsAt: e.ends_at,
        isNightEvent: e.is_night_event,
        registrationMode: e.registration_mode,
        capacityBasis: e.capacity_basis,
        priceBasis: e.price_basis,
        minTeamSize: e.min_team_size,
        maxTeamSize: e.max_team_size,
        prizePoolText: e.prize_pool_text,
        featured: e.featured,
        imageUrl: e.image_url ?? null,
        status: e.status,
        salesState: e.sales_state,
        registrationOpensAt: e.registration_opens_at,
        registrationClosesAt: e.registration_closes_at,
        version: e.version,
        amountPaise,
        inventory: inv
          ? {
              capacityUnits: inv.capacity_units,
              heldUnits: inv.held_units,
              confirmedUnits: inv.confirmed_units,
            }
          : null,
      },
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/**
 * PATCH /api/admin/events/:id — update with optimistic version
 * (plan §11.6). Stale edits return 409 VERSION_CONFLICT.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/events/[id]">
) {
  try {
    const id = requireUuid((await ctx.params).id, "Event");
    const auth = await guardAdminMutation(req, "content.event.write", {
      eventId: id,
    });
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
      p_event_id: id,
      p_festival_id: auth.festivalId,
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

    await invalidateContentCache(auth.festivalId, ["events", "schedule"]);
    await invalidateAvailability(auth.festivalId, id);
    return apiSuccess(req, { event: data });
  } catch (err) {
    return apiFromError(req, err);
  }
}
