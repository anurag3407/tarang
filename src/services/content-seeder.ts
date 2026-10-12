import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const DEFAULT_VENUES = [
  { name: "Main Quadrangle Stage", short_name: "Main Stage", description: "Central open-air stage for flagship events and pronites" },
  { name: "JL Auditorium", short_name: "JL Audi", description: "Main indoor air-conditioned auditorium" },
  { name: "LT 1 (Lecture Theatre 1)", short_name: "LT 1", description: "Indoor tiered hall for quizzes and academic events" },
  { name: "LT 2 (Lecture Theatre 2)", short_name: "LT 2", description: "Indoor tiered hall for literary competitions" },
  { name: "Gymkhana Ground", short_name: "Gymkhana", description: "Outdoor sports complex and athletic field" },
  { name: "Swimming Pool Area / CR Desk", short_name: "CR Desk", description: "Central registration and help desk area" },
];

export const DEFAULT_CATEGORIES = [
  { slug: "music", name: "Socio cultural", tagline: "Bands, vocals, acoustics & beats", icon_key: "Music", color_key: "accent", sort_order: 1 },
  { slug: "dance", name: "aQuSiS", tagline: "Solo, duet, street & crew battles", icon_key: "Drama", color_key: "secondary", sort_order: 2 },
  { slug: "drama", name: "Workshop", tagline: "Stage plays, street theatre & workshops", icon_key: "Megaphone", color_key: "muted", sort_order: 3 },
  { slug: "arts", name: "Fine Arts", tagline: "Painting, sketching, digital art & crafts", icon_key: "Palette", color_key: "white", sort_order: 4 },
  { slug: "literary", name: "Literary", tagline: "Debate, quiz, poetry & creative writing", icon_key: "Brain", color_key: "accent", sort_order: 5 },
  { slug: "sports", name: "Sports", tagline: "Cricket, football, badminton, athletics & gaming", icon_key: "Dumbbell", color_key: "secondary", sort_order: 6 },
  { slug: "medsci", name: "Scientific society", tagline: "Clinical skills, medical quiz & case presentations", icon_key: "Stethoscope", color_key: "muted", sort_order: 7 },
  { slug: "informal", name: "Informals", tagline: "Fun games, scavenger hunts & casual contests", icon_key: "Gamepad2", color_key: "white", sort_order: 8 },
];

/**
 * Idempotently ensures default categories and venues exist in the database for the festival.
 * If either is empty, automatically inserts standard defaults using the server service-role client.
 */
export async function ensureDefaultCategoriesAndVenues(festivalId: string): Promise<{
  categories: { id: string; name: string; slug: string }[];
  venues: { id: string; name: string; shortName: string | null }[];
}> {
  const sb = createServiceRoleClient();

  const [{ data: existingCats }, { data: existingVenues }] = await Promise.all([
    sb
      .from("categories")
      .select("id, name, slug")
      .eq("festival_id", festivalId)
      .order("sort_order", { ascending: true }),
    sb
      .from("venues")
      .select("id, name, short_name")
      .eq("festival_id", festivalId)
      .order("name", { ascending: true }),
  ]);

  let categories = existingCats ?? [];
  let venues = existingVenues ?? [];

  if (categories.length === 0) {
    for (const c of DEFAULT_CATEGORIES) {
      await sb.from("categories").upsert(
        {
          festival_id: festivalId,
          slug: c.slug,
          name: c.name,
          tagline: c.tagline,
          icon_key: c.icon_key,
          color_key: c.color_key,
          sort_order: c.sort_order,
          is_active: true,
        },
        { onConflict: "festival_id,slug" }
      );
    }
    const { data: refreshedCats } = await sb
      .from("categories")
      .select("id, name, slug")
      .eq("festival_id", festivalId)
      .order("sort_order", { ascending: true });
    categories = refreshedCats ?? [];
  }

  if (venues.length === 0) {
    for (const v of DEFAULT_VENUES) {
      await sb.from("venues").upsert(
        {
          festival_id: festivalId,
          name: v.name,
          short_name: v.short_name,
          description: v.description,
          is_active: true,
        },
        { onConflict: "festival_id,name" }
      );
    }
    const { data: refreshedVenues } = await sb
      .from("venues")
      .select("id, name, short_name")
      .eq("festival_id", festivalId)
      .order("name", { ascending: true });
    venues = refreshedVenues ?? [];
  }

  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, slug: c.slug })),
    venues: venues.map((v) => ({ id: v.id, name: v.name, shortName: v.short_name })),
  };
}
