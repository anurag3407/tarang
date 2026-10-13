import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseConfigured } from "@/lib/env";
import { logger } from "@/lib/logger";
import { SPONSORS } from "@/lib/data";
import {
  getCurrentFestivalId,
  getPublishedCategories,
  getPublishedEvents,
  getPublishedNotices,
  getPublishedPassProducts,
  getPublishedSchedule,
  getPublishedSponsors,
} from "@/repositories/public-content";
import type {
  CategoryRead,
  DayScheduleRead,
  EventRead,
  NoticeRead,
  PassProductRead,
  SponsorRead,
} from "@/domain/content";

/**
 * Public content loader (plan §11.10).
 *
 * Server Components call this to read published rows from Postgres through the
 * typed repositories and tag the result for on-demand invalidation.
 */

export type PublicContent = {
  events: EventRead[];
  categories: CategoryRead[];
  schedule: DayScheduleRead[];
  notices: NoticeRead[];
  passProducts: PassProductRead[];
  sponsors: SponsorRead[];
  /** Festival id from Postgres, or a placeholder if unavailable. */
  festivalId: string;
  /** "db" when served from Postgres, "static" when on fallback. */
  source: "db" | "static";
};

const EVENTS_TTL = 30; // availability moves with holds/confirmations
const CONTENT_TTL = 60;

function cachedEvents(festivalId: string) {
  return unstable_cache(
    async () => getPublishedEvents(festivalId),
    ["public-events", festivalId],
    { tags: [`festival:${festivalId}:events`], revalidate: EVENTS_TTL }
  )();
}

function cachedCategories(festivalId: string) {
  return unstable_cache(
    async () => getPublishedCategories(festivalId),
    ["public-categories", festivalId],
    { tags: [`festival:${festivalId}:events`], revalidate: CONTENT_TTL }
  )();
}

function cachedSchedule(festivalId: string) {
  return unstable_cache(
    async () => getPublishedSchedule(festivalId),
    ["public-schedule", festivalId],
    { tags: [`festival:${festivalId}:schedule`], revalidate: CONTENT_TTL }
  )();
}

function cachedNotices(festivalId: string) {
  return unstable_cache(
    async () => getPublishedNotices(festivalId),
    ["public-notices", festivalId],
    { tags: [`festival:${festivalId}:notices`], revalidate: CONTENT_TTL }
  )();
}

function cachedPassProducts(festivalId: string) {
  return unstable_cache(
    async () => getPublishedPassProducts(festivalId),
    ["public-pass-products", festivalId],
    { tags: [`festival:${festivalId}:events`, `festival:${festivalId}:pass-products`], revalidate: CONTENT_TTL }
  )();
}

function cachedSponsors(festivalId: string) {
  return unstable_cache(
    async () => getPublishedSponsors(festivalId),
    ["public-sponsors", festivalId],
    { tags: [`festival:${festivalId}:sponsors`, `festival:${festivalId}:events`], revalidate: CONTENT_TTL }
  )();
}

export async function loadPublicContent(): Promise<PublicContent> {
  if (supabaseConfigured()) {
    try {
      const festivalId = await getCurrentFestivalId();
      if (festivalId) {
        const [events, categories, schedule, notices, passProducts, sponsors] = await Promise.all([
          cachedEvents(festivalId),
          cachedCategories(festivalId),
          cachedSchedule(festivalId),
          cachedNotices(festivalId),
          cachedPassProducts(festivalId),
          cachedSponsors(festivalId),
        ]);
        return { events, categories, schedule, notices, passProducts, sponsors, festivalId, source: "db" };
      }
    } catch (err) {
      logger().warn({ err }, "public content: DB read failed");
    }
  }

  const staticSponsors: SponsorRead[] = SPONSORS.map((s, idx) => ({
    id: `static-sponsor-${idx + 1}`,
    name: s.name,
    category: s.category,
    tagline: s.tagline,
    logoUrl: s.logoUrl || "https://images.unsplash.com/photo-1516549655169-df83a0774514?auto=format&fit=crop&w=400&q=80",
    websiteUrl: s.website || null,
    colorKey: s.color,
    sortOrder: idx + 1,
    isTitle: s.category === "Title Sponsor",
  }));

  return {
    events: [],
    categories: [],
    schedule: [],
    notices: [],
    sponsors: staticSponsors,
    passProducts: [
      {
        id: "static-vip-delegate-pass",
        slug: "vip-delegate-pass",
        name: "Pronite Pass",
        description: "Every pronite, campus access and competition registration.",
        isBasePass: false,
        requiresBasePass: false,
        amountPaise: 200000,
        currency: "INR",
        salesState: "OPEN",
        validFrom: "2026-11-01T00:00:00+00:00",
        validUntil: "2026-11-23T00:00:00+00:00",
      },
    ],
    festivalId: "no-festival",
    source: "static",
  };
}

