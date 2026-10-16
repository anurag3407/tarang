import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { rupeesToPaise } from "@/lib/money";
import { readJsonBody, requireUuid } from "@/lib/route-utils";
import { eventPriceSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/events/:id/price — new immutable price version
 * (plan §11.6). Requires a reason; never updates the old version row.
 * The admin_upsert_event function handles price versioning when the price
 * differs from the current version, so we route through it with the
 * existing event fields.
 */
export async function POST(
  req: NextRequest,
  ctx: RouteContext<"/api/admin/events/[id]/price">
) {
  try {
    const id = requireUuid((await ctx.params).id, "Event");
    const auth = await guardAdminMutation(req, "content.event.price.write", {
      eventId: id,
    });
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = eventPriceSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid price change", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const { priceRupees, reason, version } = parsed.data;

    const sb = await createServerSupabase();

    // Load the current event to replay all fields through the upsert
    // function, which inserts a new price version when the amount changes.
    const { data: e, error: fetchErr } = await sb
      .from("events")
      .select(
        `slug, name, short_description, description, rules_markdown,
         category_id, venue_id, starts_at, ends_at, is_night_event,
         include_in_schedule, registration_mode, capacity_basis, price_basis,
         min_team_size, max_team_size, prize_pool_text, featured,
         registration_opens_at, registration_closes_at,
         event_inventory ( capacity_units )`
      )
      .eq("id", id)
      .maybeSingle();
    if (fetchErr || !e) return apiError(req, "NOT_FOUND", "Event not found");

    const inv = Array.isArray(e.event_inventory)
      ? e.event_inventory[0]
      : e.event_inventory;

    const { data, error } = await sb.rpc("admin_upsert_event", {
      p_event_id: id,
      p_festival_id: auth.festivalId,
      p_slug: e.slug,
      p_name: e.name,
      p_short_description: e.short_description,
      p_description: e.description,
      p_rules_markdown: e.rules_markdown,
      p_category_id: e.category_id,
      p_venue_id: e.venue_id,
      p_starts_at: e.starts_at,
      p_ends_at: e.ends_at,
      p_include_in_schedule: e.include_in_schedule,
      p_is_night_event: e.is_night_event,
      p_registration_mode: e.registration_mode,
      p_capacity_basis: e.capacity_basis,
      p_price_basis: e.price_basis,
      p_min_team_size: e.min_team_size,
      p_max_team_size: e.max_team_size,
      p_capacity_units: inv?.capacity_units ?? 1,
      p_price_paise: rupeesToPaise(priceRupees),
      p_prize_pool_text: e.prize_pool_text,
      p_registration_opens_at: e.registration_opens_at,
      p_registration_closes_at: e.registration_closes_at,
      p_featured: e.featured,
      p_expected_version: version,
      p_change_reason: reason,
    });
    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(auth.festivalId, ["events"]);
    return apiSuccess(req, { event: data });
  } catch (err) {
    return apiFromError(req, err);
  }
}
