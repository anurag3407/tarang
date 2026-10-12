import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type {
  CategoryRead,
  DayScheduleRead,
  EventRead,
  NoticeRead,
  PassProductRead,
  ScheduleEntryRead,
  SponsorRead,
} from "@/domain/content";
import { toPaise } from "@/lib/money";
import { ensureDefaultCategoriesAndVenues } from "@/services/content-seeder";

/**
 * Public content repository (plan §11.10).
 *
 * Server-side read models that preserve the current UI shape while adding
 * IDs, status, amount paise, and availability metadata. Reads published
 * rows only. All queries are bounded and deterministically ordered.
 */

const IST = "Asia/Kolkata";

function dayNumber(startsAt: string, festStart: string): number {
  const d = new Date(startsAt);
  const s = new Date(festStart);
  const dayMs = 86_400_000;
  const dUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const sUtc = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  return Math.max(1, Math.round((dUtc - sUtc) / dayMs) + 1);
}

function formatDateLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: IST,
  }).format(new Date(iso));
}

function formatTimeLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  }).format(new Date(iso));
}

function teamSizeLabel(
  mode: string,
  min: number,
  max: number
): string {
  if (mode === "INDIVIDUAL") return "Solo";
  if (min === max) return `${min} members`;
  return `${min}–${max} members`;
}

// The active festival id is read on every authenticated request (authz,
// checkout, scanner). It changes at most once per edition, so cache it
// in-process for 30s to keep a hot path off the DB under load.
let festivalIdCache: { id: string | null; at: number } | null = null;
const FESTIVAL_ID_TTL_MS = 30_000;

export async function getCurrentFestivalId(): Promise<string | null> {
  if (festivalIdCache && Date.now() - festivalIdCache.at < FESTIVAL_ID_TTL_MS) {
    return festivalIdCache.id;
  }
  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("festivals")
    .select("id")
    .eq("status", "PUBLISHED")
    .order("starts_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    // Serve the last known value on a transient DB error rather than
    // failing every authenticated request.
    return festivalIdCache?.id ?? null;
  }
  festivalIdCache = { id: (data?.id as string | null) ?? null, at: Date.now() };
  return festivalIdCache.id;
}

export async function getPublishedCategories(
  festivalId: string
): Promise<CategoryRead[]> {
  const sb = createServiceRoleClient();
  const { data: initialData, error } = await sb
    .from("categories")
    .select("id, slug, name, tagline, icon_key, color_key, sort_order")
    .eq("festival_id", festivalId)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  let data = initialData;

  if (!data || data.length === 0) {
    await ensureDefaultCategoriesAndVenues(festivalId);
    const res = await sb
      .from("categories")
      .select("id, slug, name, tagline, icon_key, color_key, sort_order")
      .eq("festival_id", festivalId)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    data = res.data ?? [];
  }

  return (data ?? []).map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    tagline: c.tagline ?? "",
    iconKey: c.icon_key ?? "Music",
    colorKey: (c.color_key as CategoryRead["colorKey"]) ?? "white",
    sortOrder: c.sort_order ?? 0,
  }));
}

export async function getPublishedEvents(
  festivalId: string,
  opts: { featuredOnly?: boolean } = {}
): Promise<EventRead[]> {
  const sb = createServiceRoleClient();
  let query = sb
    .from("events")
    .select(
      `id, slug, name, short_description, description, rules_markdown,
       starts_at, ends_at, is_night_event, registration_mode, capacity_basis,
       price_basis, min_team_size, max_team_size, current_price_version_id,
       sales_state, registration_opens_at, registration_closes_at,
       prize_pool_text, featured, image_url, sort_order, category_id, venue_id,
       categories ( id, slug, name, tagline, icon_key, color_key, sort_order ),
       venues ( id, name, short_name )`
    )
    .eq("festival_id", festivalId)
    .eq("status", "PUBLISHED")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (opts.featuredOnly) query = query.eq("featured", true);

  const { data: events, error } = await query;
  if (error) throw error;

  // Availability in one bounded query.
  const eventIds = (events ?? []).map((e) => e.id);
  const inventory = new Map<string, { capacity: number; held: number; confirmed: number }>();
  if (eventIds.length > 0) {
    const { data: inv } = await sb
      .from("event_inventory")
      .select("event_id, capacity_units, held_units, confirmed_units")
      .in("event_id", eventIds);
    for (const row of inv ?? []) {
      inventory.set(row.event_id, {
        capacity: row.capacity_units,
        held: row.held_units,
        confirmed: row.confirmed_units,
      });
    }
  }

  // Current prices in one query.
  const priceVersionIds = (events ?? [])
    .map((e) => e.current_price_version_id)
    .filter(Boolean);
  const prices = new Map<string, number>();
  if (priceVersionIds.length > 0) {
    const { data: pv } = await sb
      .from("event_price_versions")
      .select("id, unit_amount_paise")
      .in("id", priceVersionIds);
    for (const row of pv ?? []) {
      prices.set(row.id, toPaise(row.unit_amount_paise));
    }
  }

  // Festival start for day numbering.
  const { data: fest } = await sb
    .from("festivals")
    .select("starts_at")
    .eq("id", festivalId)
    .single();
  const festStart = fest?.starts_at ?? new Date().toISOString();

  return (events ?? []).map((e) => {
    const inv = inventory.get(e.id);
    const cat = Array.isArray(e.categories) ? e.categories[0] : e.categories;
    const venue = Array.isArray(e.venues) ? e.venues[0] : e.venues;
    const capacityBasis = e.capacity_basis as "TEAM" | "PARTICIPANT";
    return {
      id: e.id,
      slug: e.slug,
      name: e.name,
      shortDescription: e.short_description,
      description: e.description,
      rulesMarkdown: e.rules_markdown,
      category: {
        id: cat?.id ?? "",
        slug: cat?.slug ?? "",
        name: cat?.name ?? "",
        tagline: cat?.tagline ?? "",
        iconKey: cat?.icon_key ?? "Music",
        colorKey: (cat?.color_key as CategoryRead["colorKey"]) ?? "white",
        sortOrder: cat?.sort_order ?? 0,
      },
      venue: venue ? { id: venue.id, name: venue.name, shortName: venue.short_name } : null,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      day: dayNumber(e.starts_at, festStart),
      dateLabel: formatDateLabel(e.starts_at),
      timeLabel: `${formatTimeLabel(e.starts_at)} – ${formatTimeLabel(e.ends_at)}`,
      isNightEvent: e.is_night_event,
      registrationMode: e.registration_mode,
      capacityBasis,
      priceBasis: e.price_basis,
      minTeamSize: e.min_team_size,
      maxTeamSize: e.max_team_size,
      teamSizeLabel: teamSizeLabel(e.registration_mode, e.min_team_size, e.max_team_size),
      amountPaise: prices.get(e.current_price_version_id) ?? 0,
      currency: "INR",
      prizePoolText: e.prize_pool_text,
      featured: e.featured,
      imageUrl: e.image_url ?? null,
      salesState: e.sales_state,
      registrationOpensAt: e.registration_opens_at,
      registrationClosesAt: e.registration_closes_at,
      availability: inv
        ? {
            capacityUnits: inv.capacity,
            heldUnits: inv.held,
            confirmedUnits: inv.confirmed,
            availableUnits: Math.max(0, inv.capacity - inv.held - inv.confirmed),
            unitLabel: capacityBasis === "TEAM" ? "team" : "participant",
          }
        : null,
    } satisfies EventRead;
  });
}

export async function getPublishedEventBySlug(
  festivalId: string,
  slug: string
): Promise<EventRead | null> {
  const all = await getPublishedEvents(festivalId);
  return all.find((e) => e.slug === slug) ?? null;
}

export async function getPublishedSchedule(
  festivalId: string
): Promise<DayScheduleRead[]> {
  const sb = createServiceRoleClient();
  const { data: entries, error } = await sb
    .from("schedule_entries")
    .select(
      `id, linked_event_id, title, starts_at, ends_at, category_key, is_night,
       day_theme, sort_order, venue_id,
       venues ( name ),
       events ( slug, name, starts_at, ends_at, venue_id, category_id, is_night_event,
         venues ( name ), categories ( slug ) )`
    )
    .eq("festival_id", festivalId)
    .eq("status", "PUBLISHED")
    .order("starts_at", { ascending: true });
  if (error) throw error;

  const { data: fest } = await sb
    .from("festivals")
    .select("starts_at")
    .eq("id", festivalId)
    .single();
  const festStart = fest?.starts_at ?? new Date().toISOString();

  const byDay = new Map<number, DayScheduleRead>();

  // PostgREST embeds may arrive as an array or a single object depending on
  // the relation; normalize before reading fields.
  const first = <T>(v: T | T[] | null | undefined): T | null => {
    if (v === null || v === undefined) return null;
    return Array.isArray(v) ? (v[0] ?? null) : v;
  };

  for (const entry of entries ?? []) {
    const linked = first(entry.events) as
      | {
          slug: string;
          name: string;
          starts_at: string;
          ends_at: string;
          is_night_event: boolean;
          venues: unknown;
          categories: unknown;
        }
      | null;
    // Linked events derive title/time/venue from the event (no overrides).
    const startsAt = linked ? linked.starts_at : entry.starts_at;
    const title = linked ? linked.name : entry.title ?? "";
    const linkedVenue = first(linked?.venues) as { name?: string } | null;
    const entryVenue = first(entry.venues) as { name?: string } | null;
    const venueName = (linked ? linkedVenue?.name : entryVenue?.name) ?? "";
    const linkedCategory = first(linked?.categories) as { slug?: string } | null;
    const categoryKey = linked
      ? linkedCategory?.slug ?? entry.category_key
      : entry.category_key;
    const isNight = linked ? linked.is_night_event : entry.is_night;

    const day = dayNumber(startsAt, festStart);
    if (!byDay.has(day)) {
      const dateObj = new Date(startsAt);
      byDay.set(day, {
        day,
        dateLabel: formatDateLabel(startsAt),
        weekday: new Intl.DateTimeFormat("en-IN", {
          weekday: "long",
          timeZone: IST,
        }).format(dateObj),
        theme: entry.day_theme ?? `Day ${day}`,
        items: [],
      });
    }

    const item: ScheduleEntryRead = {
      id: entry.id,
      day,
      dateLabel: formatDateLabel(startsAt),
      timeLabel: formatTimeLabel(startsAt),
      title,
      venue: venueName,
      categoryKey,
      isNight,
      linkedEventSlug: linked?.slug ?? null,
    };
    byDay.get(day)!.items.push(item);
  }

  const days = [...byDay.values()].sort((a, b) => a.day - b.day);
  for (const d of days) {
    d.items.sort((a, b) => a.timeLabel.localeCompare(b.timeLabel));
  }
  return days;
}

export async function getPublishedNotices(
  festivalId: string,
  opts: { limit?: number } = {}
): Promise<NoticeRead[]> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("notices")
    .select("id, slug, tag, title, body_markdown, publish_at, pinned")
    .eq("festival_id", festivalId)
    .eq("status", "PUBLISHED")
    .lte("publish_at", new Date().toISOString())
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("pinned", { ascending: false })
    .order("publish_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (error) throw error;
  return (data ?? []).map((n) => ({
    id: n.id,
    slug: n.slug,
    tag: n.tag,
    title: n.title,
    bodyMarkdown: n.body_markdown,
    publishedAt: n.publish_at,
    dateLabel: new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: IST,
    }).format(new Date(n.publish_at)),
    pinned: n.pinned,
  }));
}

export async function getPublishedPassProducts(
  festivalId: string
): Promise<PassProductRead[]> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("pass_products")
    .select(
      `id, slug, name, description, is_base_pass, requires_base_pass, sales_state, valid_from,
       valid_until, current_price_version_id`
    )
    .eq("festival_id", festivalId)
    .eq("status", "PUBLISHED")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) throw error;

  const priceIds = (data ?? [])
    .map((p) => p.current_price_version_id)
    .filter(Boolean);
  const prices = new Map<string, number>();
  if (priceIds.length > 0) {
    const { data: pv } = await sb
      .from("pass_price_versions")
      .select("id, unit_amount_paise")
      .in("id", priceIds);
    for (const row of pv ?? []) prices.set(row.id, toPaise(row.unit_amount_paise));
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    isBasePass: p.is_base_pass,
    requiresBasePass: p.requires_base_pass,
    salesState: p.sales_state as PassProductRead["salesState"],
    validFrom: p.valid_from,
    validUntil: p.valid_until,
    amountPaise: prices.get(p.current_price_version_id) ?? 0,
    currency: "INR",
  }));
}

export async function getPublishedSponsors(
  festivalId: string
): Promise<SponsorRead[]> {
  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from("sponsors")
    .select("id, name, category, tagline, logo_url, website_url, color_key, sort_order, is_title")
    .eq("festival_id", festivalId)
    .eq("is_active", true)
    .order("is_title", { ascending: false })
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    tagline: s.tagline ?? "",
    logoUrl: s.logo_url,
    websiteUrl: s.website_url ?? null,
    colorKey: (s.color_key as SponsorRead["colorKey"]) ?? "secondary",
    sortOrder: s.sort_order ?? 0,
    isTitle: Boolean(s.is_title),
  }));
}


