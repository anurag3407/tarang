/**
 * Idempotent content seed (plan §11.10).
 *
 * Imports the current CATEGORIES, EVENTS, SCHEDULE, and NOTICES from
 * src/lib/data.ts into Supabase. Safe to re-run: everything upserts by slug.
 *
 * Usage: pnpm seed:content
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  CATEGORIES,
  EVENTS,
  SCHEDULE,
  NOTICES,
  type FestEvent,
} from "../src/lib/data";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FEST_SLUG = process.env.FEST_SLUG ?? "pulse-2026";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const FEST_YEAR = 2026;
const DAY_DATES: Record<number, string> = {
  1: `${FEST_YEAR}-02-24`,
  2: `${FEST_YEAR}-02-25`,
  3: `${FEST_YEAR}-02-26`,
  4: `${FEST_YEAR}-02-27`,
  5: `${FEST_YEAR}-02-28`,
};

function parseTimeToIso(date: string, time: string): { start: string; end: string } {
  // "10:00 AM – 2:00 PM" | "8:00 AM onwards" | "12:00 PM"
  const cleaned = time.replace(/onwards/i, "").trim();
  const parts = cleaned.split(/[–—-]/).map((s) => s.trim()).filter(Boolean);
  const parse = (t: string): string => {
    const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return "10:00:00";
    let h = parseInt(m[1], 10) % 12;
    if (m[3].toUpperCase() === "PM") h += 12;
    return `${String(h).padStart(2, "0")}:${m[2]}:00`;
  };
  const start = parse(parts[0] ?? "10:00 AM");
  const end = parts.length > 1 ? parse(parts[1]) : addHours(start, 2);
  return { start: `${date}T${start}+05:30`, end: `${date}T${end}+05:30` };
}

function addHours(hhmmss: string, hours: number): string {
  const [h, m, s] = hhmmss.split(":").map(Number);
  const total = (h + hours) % 24;
  return `${String(total).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function parseTeamSize(teamSize: string): {
  mode: "INDIVIDUAL" | "TEAM";
  min: number;
  max: number;
} {
  const t = teamSize.toLowerCase();
  if (t.includes("solo") && !t.includes("duo")) {
    return { mode: "INDIVIDUAL", min: 1, max: 1 };
  }
  if (t.includes("solo / duo") || t.includes("solo/duo")) {
    return { mode: "TEAM", min: 1, max: 2 };
  }
  const range = t.match(/(\d+)\s*[–—-]\s*(\d+)/);
  if (range) {
    return { mode: "TEAM", min: parseInt(range[1], 10), max: parseInt(range[2], 10) };
  }
  const exact = t.match(/(\d+)\s*members?/);
  if (exact) {
    const n = parseInt(exact[1], 10);
    return { mode: "TEAM", min: n, max: n };
  }
  // "Everyone", "Solo entry", etc.
  return { mode: "INDIVIDUAL", min: 1, max: 1 };
}

async function main() {
  const { data: festival, error: festErr } = await sb
    .from("festivals")
    .select("id")
    .eq("slug", FEST_SLUG)
    .single();
  if (festErr || !festival) {
    console.error(`Festival ${FEST_SLUG} not found. Run seed.sql first.`);
    process.exit(1);
  }
  const festivalId = festival.id as string;
  console.log(`Seeding into festival ${festivalId}`);

  // Categories
  const categoryIds = new Map<string, string>();
  for (const [i, cat] of CATEGORIES.entries()) {
    const { data, error } = await sb
      .from("categories")
      .upsert(
        {
          festival_id: festivalId,
          slug: cat.id,
          name: cat.name,
          tagline: cat.tagline,
          icon_key: cat.icon,
          color_key: cat.color,
          sort_order: i,
          is_active: true,
        },
        { onConflict: "festival_id,slug" }
      )
      .select("id")
      .single();
    if (error) throw error;
    categoryIds.set(cat.id, data.id as string);
  }
  console.log(`✓ ${CATEGORIES.length} categories`);

  // Venues (deduped from events + schedule)
  const venueNames = new Set<string>();
  for (const e of EVENTS) venueNames.add(e.venue.split(",")[0].trim());
  for (const d of SCHEDULE) for (const item of d.items) venueNames.add(item.venue.split(",")[0].trim());

  const venueIds = new Map<string, string>();
  for (const name of venueNames) {
    const { data, error } = await sb
      .from("venues")
      .upsert(
        { festival_id: festivalId, name, is_active: true },
        { onConflict: "festival_id,name" }
      )
      .select("id")
      .single();
    if (error) throw error;
    venueIds.set(name, data.id as string);
  }
  console.log(`✓ ${venueNames.size} venues`);

  // Events
  for (const [i, ev] of EVENTS.entries()) {
    await seedEvent(festivalId, ev, i, categoryIds, venueIds);
  }
  console.log(`✓ ${EVENTS.length} events`);

  // Schedule entries
  for (const day of SCHEDULE) {
    const date = DAY_DATES[day.day];
    for (const [i, item] of day.items.entries()) {
      const { start, end } = parseTimeToIso(date, item.time);
      const venueName = item.venue.split(",")[0].trim();
      const linkedEvent = await findEventByScheduleTitle(item.title);
      const { error } = await sb.from("schedule_entries").upsert(
        {
          festival_id: festivalId,
          linked_event_id: linkedEvent,
          title: linkedEvent ? null : item.title,
          venue_id: venueIds.get(venueName) ?? null,
          starts_at: start,
          ends_at: end,
          category_key: item.category,
          is_night: item.night ?? false,
          day_theme: day.theme,
          status: "PUBLISHED",
          sort_order: i,
        },
        { onConflict: "id" }
      );
      if (error) {
        // No natural unique for standalone entries; insert-if-absent instead.
        const { data: existing } = await sb
          .from("schedule_entries")
          .select("id")
          .eq("festival_id", festivalId)
          .eq("starts_at", start)
          .eq("title", item.title)
          .maybeSingle();
        if (!existing) {
          const { error: insErr } = await sb.from("schedule_entries").insert({
            festival_id: festivalId,
            linked_event_id: linkedEvent,
            title: linkedEvent ? null : item.title,
            venue_id: venueIds.get(venueName) ?? null,
            starts_at: start,
            ends_at: end,
            category_key: item.category,
            is_night: item.night ?? false,
            day_theme: day.theme,
            status: "PUBLISHED",
            sort_order: i,
          });
          if (insErr) throw insErr;
        }
      }
    }
  }
  console.log(`✓ schedule entries`);

  // Notices
  for (const n of NOTICES) {
    const publishAt = new Date(`${n.date} 09:00:00 UTC`).toISOString();
    const { error } = await sb.from("notices").upsert(
      {
        festival_id: festivalId,
        slug: `notice-${n.id}`,
        tag: n.tag,
        title: n.title,
        body_markdown: n.body,
        status: "PUBLISHED",
        publish_at: publishAt,
        pinned: false,
      },
      { onConflict: "festival_id,slug" }
    );
    if (error) throw error;
  }
  console.log(`✓ ${NOTICES.length} notices`);

  console.log("Seed complete.");
}

async function findEventByScheduleTitle(title: string): Promise<string | null> {
  // Link schedule rows to events when the title starts with the event name.
  const base = title.split("—")[0].split(" — ")[0].replace(/PRO SHOW — /i, "").trim();
  for (const ev of EVENTS) {
    if (base.toLowerCase().startsWith(ev.name.toLowerCase())) {
      const { data } = await sb
        .from("events")
        .select("id")
        .eq("slug", ev.id)
        .maybeSingle();
      if (data) return data.id as string;
    }
  }
  return null;
}

async function seedEvent(
  festivalId: string,
  ev: FestEvent,
  sortOrder: number,
  categoryIds: Map<string, string>,
  venueIds: Map<string, string>
) {
  const { mode, min, max } = parseTeamSize(ev.teamSize);
  const date = DAY_DATES[ev.day];
  const { start, end } = parseTimeToIso(date, ev.time);
  const venueName = ev.venue.split(",")[0].trim();
  const pricePaise = ev.entryFee * 100;
  const isTeam = mode === "TEAM";
  const capacityUnits = isTeam ? (min >= 6 ? 12 : 20) : 60;

  const { data: existing } = await sb
    .from("events")
    .select("id, current_price_version_id")
    .eq("festival_id", festivalId)
    .eq("slug", ev.id)
    .maybeSingle();

  let eventId: string;
  if (existing) {
    eventId = existing.id as string;
    const { error } = await sb
      .from("events")
      .update({
        name: ev.name,
        short_description: ev.description.slice(0, 280),
        description: ev.description,
        category_id: categoryIds.get(ev.category),
        venue_id: venueIds.get(venueName) ?? null,
        starts_at: start,
        ends_at: end,
        registration_mode: mode,
        capacity_basis: isTeam ? "TEAM" : "PARTICIPANT",
        price_basis: isTeam ? "REGISTRATION" : "PARTICIPANT",
        min_team_size: min,
        max_team_size: max,
        prize_pool_text: ev.prizePool,
        featured: ev.featured ?? false,
        sort_order: sortOrder,
        status: "PUBLISHED",
        sales_state: "OPEN",
        published_at: new Date().toISOString(),
      })
      .eq("id", eventId);
    if (error) throw error;
  } else {
    const { data, error } = await sb
      .from("events")
      .insert({
        festival_id: festivalId,
        slug: ev.id,
        name: ev.name,
        short_description: ev.description.slice(0, 280),
        description: ev.description,
        category_id: categoryIds.get(ev.category),
        venue_id: venueIds.get(venueName) ?? null,
        starts_at: start,
        ends_at: end,
        registration_mode: mode,
        capacity_basis: isTeam ? "TEAM" : "PARTICIPANT",
        price_basis: isTeam ? "REGISTRATION" : "PARTICIPANT",
        min_team_size: min,
        max_team_size: max,
        prize_pool_text: ev.prizePool,
        featured: ev.featured ?? false,
        sort_order: sortOrder,
        status: "PUBLISHED",
        sales_state: "OPEN",
        published_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    eventId = data.id as string;
  }

  // Immutable price version (insert only when amount differs).
  const { data: priceVersions } = await sb
    .from("event_price_versions")
    .select("id, unit_amount_paise")
    .eq("event_id", eventId)
    .order("version", { ascending: false })
    .limit(1);
  const latest = priceVersions?.[0];
  if (!latest || Number(latest.unit_amount_paise) !== pricePaise) {
    const nextVersion = latest ? 2 : 1;
    const { data: pv, error: pvErr } = await sb
      .from("event_price_versions")
      .insert({
        event_id: eventId,
        version: nextVersion,
        unit_amount_paise: pricePaise,
        change_reason: "seed",
      })
      .select("id")
      .single();
    if (pvErr) throw pvErr;
    await sb
      .from("events")
      .update({ current_price_version_id: pv.id })
      .eq("id", eventId);
  }

  // Inventory row (exactly one per event).
  const { data: inv } = await sb
    .from("event_inventory")
    .select("event_id")
    .eq("event_id", eventId)
    .maybeSingle();
  if (!inv) {
    const { error } = await sb
      .from("event_inventory")
      .insert({ event_id: eventId, capacity_units: capacityUnits });
    if (error) throw error;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
