import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation, guardAdminRead, mapAdminRpcError } from "@/lib/admin-route";
import { createServerSupabase } from "@/lib/supabase/server";
import { readJsonBody } from "@/lib/route-utils";
import { scheduleAdminSchema } from "@/lib/validation/schemas";
import { invalidateContentCache } from "@/lib/invalidation";

export const dynamic = "force-dynamic";

/** GET /api/admin/schedule — all schedule entries incl. drafts. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await guardAdminRead(req, "content.schedule.write");
    const sb = await createServerSupabase();

    const { data, error } = await sb
      .from("schedule_entries")
      .select(
        `id, linked_event_id, title, starts_at, ends_at, category_key, is_night,
         day_theme, status, version, venue_id, sort_order,
         venues ( name ),
         events ( name, slug )`
      )
      .eq("festival_id", ctx.festivalId)
      .order("starts_at", { ascending: true })
      .limit(500);
    if (error) return apiError(req, "INTERNAL", "Could not load schedule");

    const entries = (data ?? []).map((entry) => {
      const venue = Array.isArray(entry.venues) ? entry.venues[0] : entry.venues;
      const linked = Array.isArray(entry.events) ? entry.events[0] : entry.events;
      return {
        id: entry.id,
        linkedEventId: entry.linked_event_id,
        linkedEventName: linked?.name ?? null,
        title: entry.title,
        startsAt: entry.starts_at,
        endsAt: entry.ends_at,
        categoryKey: entry.category_key,
        isNight: entry.is_night,
        dayTheme: entry.day_theme,
        status: entry.status,
        version: entry.version,
        venueId: entry.venue_id,
        venueName: venue?.name ?? null,
        sortOrder: entry.sort_order,
      };
    });
    return apiSuccess(req, { entries });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/** POST /api/admin/schedule — create a schedule entry (plan §11.7). */
export async function POST(req: NextRequest) {
  try {
    const ctx = await guardAdminMutation(req, "content.schedule.write");
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = scheduleAdminSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid schedule entry", {
        issues: parsed.error.issues.map((i) => i.message),
      });
    }
    const input = parsed.data;

    const sb = await createServerSupabase();
    const { data, error } = await sb.rpc("admin_upsert_schedule_entry", {
      p_entry_id: null,
      p_festival_id: ctx.festivalId,
      p_linked_event_id: input.linkedEventId,
      p_title: input.title,
      p_venue_id: input.venueId,
      p_starts_at: input.startsAt,
      p_ends_at: input.endsAt,
      p_category_key: input.categoryKey,
      p_is_night: input.isNight,
      p_day_theme: input.dayTheme,
      p_expected_version: input.version,
    });
    if (error) {
      const mapped = mapAdminRpcError(error);
      return apiError(req, mapped.code, mapped.message);
    }

    await invalidateContentCache(ctx.festivalId, ["schedule"]);
    return apiSuccess(req, { entry: data }, 201);
  } catch (err) {
    return apiFromError(req, err);
  }
}
