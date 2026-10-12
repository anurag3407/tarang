import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FESTIVAL_ID, resetWorld, sb } from "./helpers/mocks";

const PRODUCT_ID_SAFE = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
import { get, json, expectOkEnvelope, expectErrEnvelope } from "./helpers/requests";

vi.mock("@/lib/supabase/service-role", async () => {
  const m = await import("./helpers/mocks");
  return { createServiceRoleClient: () => m.sb };
});
vi.mock("next/cache", async () => {
  const m = await import("./helpers/mocks");
  return {
    unstable_cache: (fn: unknown) => fn,
    revalidateTag: (...args: unknown[]) => {
      m.revalidateLog.push(String(args[0]));
    },
  };
});
// Public reads use the REAL rate-limit module: Redis is unset in the test
// env, so the documented fail-open behavior for the "public" class is what
// actually runs here.

import { GET as eventsListRoute } from "@/app/api/public/events/route";
import { GET as eventBySlugRoute } from "@/app/api/public/events/[slug]/route";
import { GET as noticesRoute } from "@/app/api/public/notices/route";
import { GET as scheduleRoute } from "@/app/api/public/schedule/route";
import { GET as passProductsRoute } from "@/app/api/public/pass-products/route";

const FEST_START = "2027-02-24T04:30:00+05:30";

function seedDbCatalog(): void {
  sb.onTable("events", {
    data: [
      {
        id: "evt-featured",
        slug: "hackathon",
        name: "Hackathon",
        short_description: "36 hours of building",
        description: "Build something great in 36 hours with your team.",
        rules_markdown: null,
        starts_at: "2027-02-26T10:00:00Z",
        ends_at: "2027-02-27T18:00:00Z",
        is_night_event: false,
        registration_mode: "TEAM",
        capacity_basis: "TEAM",
        price_basis: "REGISTRATION",
        min_team_size: 2,
        max_team_size: 4,
        current_price_version_id: "pv-1",
        sales_state: "OPEN",
        registration_opens_at: null,
        registration_closes_at: null,
        prize_pool_text: "₹50k",
        featured: true,
        image_url: "https://example.com/hackathon-poster.jpg",
        sort_order: 1,
        category_id: "cat-1",
        venue_id: null,
        categories: {
          id: "cat-1",
          slug: "tech",
          name: "Tech",
          tagline: "",
          icon_key: "Code",
          color_key: "blue",
          sort_order: 0,
        },
        venues: null,
      },
      {
        id: "evt-plain",
        slug: "battle-of-bands",
        name: "Battle of Bands",
        short_description: "Loudest band wins.",
        description: "Bring your amps and your loudest riffs to the stage.",
        rules_markdown: null,
        starts_at: "2027-02-24T18:00:00Z",
        ends_at: "2027-02-24T21:00:00Z",
        is_night_event: true,
        registration_mode: "INDIVIDUAL",
        capacity_basis: "PARTICIPANT",
        price_basis: "PARTICIPANT",
        min_team_size: 1,
        max_team_size: 1,
        current_price_version_id: "pv-2",
        sales_state: "OPEN",
        registration_opens_at: null,
        registration_closes_at: null,
        prize_pool_text: "",
        featured: false,
        sort_order: 2,
        category_id: "cat-1",
        venue_id: null,
        categories: null,
        venues: { id: "v-1", name: "Open Air Stage", short_name: "OAS" },
      },
    ],
    error: null,
  });
  sb.onTable("categories", { data: [], error: null });
  sb.onTable("schedule_entries", { data: [], error: null });
  sb.onTable("notices", {
    data: [
      {
        id: "n-1",
        slug: "passes-live",
        tag: "REGISTRATION",
        title: "Passes are live",
        body_markdown: "Grab yours now.",
        publish_at: "2026-08-01T00:00:00Z",
        pinned: true,
      },
      {
        id: "n-2",
        slug: "venue-change",
        tag: "URGENT",
        title: "Venue change",
        body_markdown: "Event moved to the main auditorium.",
        publish_at: "2026-08-10T00:00:00Z",
        pinned: false,
      },
    ],
    error: null,
  });
  // Availability + prices + festival start (events repo), festivals again (schedule repo).
  sb.onTable("event_inventory", {
    data: [{ event_id: "evt-featured", capacity_units: 100, held_units: 20, confirmed_units: 30 }],
    error: null,
  });
  sb.onTable("event_price_versions", {
    data: [
      { id: "pv-1", unit_amount_paise: "25050" },
      { id: "pv-2", unit_amount_paise: "15000" },
    ],
    error: null,
  });
  sb.onTable("festivals", { data: { starts_at: FEST_START }, error: null }); // events repo
  sb.onTable("festivals", { data: { starts_at: FEST_START }, error: null }); // schedule repo
}

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  // Expire the module-level festival-id cache (30s TTL) between tests so
  // every request re-reads `festivals` and queue order stays deterministic.
  vi.advanceTimersByTime(31_000);
  resetWorld();
});

describe("GET /api/public/events", () => {
  it("serves the DB catalog with derived day/date labels and availability math", async () => {
    seedDbCatalog();

    const res = await eventsListRoute(get("/api/public/events"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.source).toBe("db");
    expect(body.data.festivalId).toBe(FESTIVAL_ID);

    const events = body.data.events as Array<Record<string, unknown>>;
    expect(events).toHaveLength(2);

    const hack = events.find((e) => e.slug === "hackathon")!;
    // Day numbering uses UTC calendar dates: fest starts 2027-02-23T23:00Z.
    expect(hack.day).toBe(4);
    expect(hack.amountPaise).toBe(25050);
    expect(hack.imageUrl).toBe("https://example.com/hackathon-poster.jpg");
    expect(hack.teamSizeLabel).toBe("2–4 members");
    expect(hack.availability).toMatchObject({
      capacityUnits: 100,
      heldUnits: 20,
      confirmedUnits: 30,
      availableUnits: 50,
      unitLabel: "team",
    });

    const bands = events.find((e) => e.slug === "battle-of-bands")!;
    expect(bands.day).toBe(2);
    expect(bands.venue).toEqual({ id: "v-1", name: "Open Air Stage", shortName: "OAS" });
    expect(bands.availability).toBeNull(); // no inventory row yet
  });

  it("?featured=true filters client-side without extra queries", async () => {
    seedDbCatalog();

    const res = await eventsListRoute(get("/api/public/events?featured=true"));
    const body = await json(res);
    expectOkEnvelope(body);
    const events = body.data.events as Array<{ slug: string }>;
    expect(events.map((e) => e.slug)).toEqual(["hackathon"]);
  });
});

describe("GET /api/public/events/:slug", () => {
  it("returns one event by slug", async () => {
    seedDbCatalog();

    const res = await eventBySlugRoute(
      get("/api/public/events/hackathon"),
      ctxOf("hackathon")
    );
    const body = await json(res);
    expectOkEnvelope(body);
    expect((body.data.event as { slug: string }).slug).toBe("hackathon");
  });

  it("404s an unknown slug with a stable code", async () => {
    seedDbCatalog();

    const res = await eventBySlugRoute(
      get("/api/public/events/nope"),
      ctxOf("nope")
    );
    expect(res.status).toBe(404);
    const body = await json(res);
    expectErrEnvelope(body, "NOT_FOUND");
  });
});

describe("GET /api/public/notices", () => {
  it("lists published notices newest-first", async () => {
    seedDbCatalog();

    const res = await noticesRoute(get("/api/public/notices"));
    const body = await json(res);
    expectOkEnvelope(body);
    const notices = body.data.notices as Array<{ id: string; pinned: boolean }>;
    expect(notices.map((n) => n.id)).toEqual(["n-1", "n-2"]);
    expect(notices[0].pinned).toBe(true);
  });

  it("clamps ?limit into [1, 50]", async () => {
    seedDbCatalog();

    const zero = await json(await noticesRoute(get("/api/public/notices?limit=0")));
    expectOkEnvelope(zero);
    expect(zero.data.notices).toHaveLength(1); // clamped up from 0

    sb.reset();
    seedDbCatalog();
    const huge = await json(await noticesRoute(get("/api/public/notices?limit=9999")));
    expectOkEnvelope(huge);
    expect(huge.data.notices).toHaveLength(2); // all we have; clamp caps at 50
  });
});

describe("GET /api/public/schedule", () => {
  it("groups linked + standalone entries by day, deriving linked fields from the event", async () => {
    sb.onTable("schedule_entries", {
      data: [
        {
          id: "se-linked",
          linked_event_id: "evt-1",
          title: null,
          starts_at: "2027-02-26T06:00:00Z", // overridden by the event's time
          ends_at: "2027-02-26T08:00:00Z",
          category_key: "misc",
          is_night: false,
          day_theme: "Build Day",
          sort_order: 1,
          venue_id: null,
          venues: null,
          events: {
            slug: "hackathon",
            name: "Hackathon",
            starts_at: "2027-02-26T10:00:00Z",
            ends_at: "2027-02-26T13:00:00Z",
            venue_id: "v-9",
            category_id: "cat-x",
            is_night_event: true,
            venues: [{ name: "Innovation Lab" }],
            categories: [{ slug: "tech" }],
          },
        },
        {
          id: "se-solo",
          linked_event_id: null,
          title: "Opening Ceremony",
          starts_at: "2027-02-24T09:00:00Z",
          ends_at: "2027-02-24T10:00:00Z",
          category_key: "ceremony",
          is_night: false,
          day_theme: "Opening Day",
          sort_order: 0,
          venue_id: "v-1",
          venues: [{ name: "Main Auditorium" }],
          events: null,
        },
      ],
      error: null,
    });
    sb.onTable("categories", { data: [], error: null });
    sb.onTable("events", { data: [], error: null });
    sb.onTable("notices", { data: [], error: null });
    sb.onTable("festivals", { data: { starts_at: FEST_START }, error: null });
    sb.onTable("festivals", { data: { starts_at: FEST_START }, error: null });

    const res = await scheduleRoute(get("/api/public/schedule"));
    const body = await json(res);
    expectOkEnvelope(body);
    const days = body.data.days as Array<{
      day: number;
      theme: string;
      items: Array<Record<string, unknown>>;
    }>;

    expect(days.map((d) => d.day)).toEqual([2, 4]);
    expect(days[0].theme).toBe("Opening Day");
    expect(days[0].items[0]).toMatchObject({
      title: "Opening Ceremony",
      venue: "Main Auditorium",
      categoryKey: "ceremony",
      isNight: false,
      linkedEventSlug: null,
    });
    // Linked entry inherits name/time/venue/category/isNight from its event.
    expect(days[1].items[0]).toMatchObject({
      title: "Hackathon",
      venue: "Innovation Lab",
      categoryKey: "tech",
      isNight: true,
      linkedEventSlug: "hackathon",
    });
  });
});

describe("GET /api/public/pass-products", () => {
  it("joins published products with their current price version", async () => {
    sb.onTable("pass_products", {
      data: [
        {
          id: PRODUCT_ID_SAFE,
          slug: "base-delegate-pass",
          name: "Base Delegate Pass",
          description: "5-day access",
          is_base_pass: true,
          sales_state: "OPEN",
          valid_from: "2026-09-01T00:00:00Z",
          valid_until: "2027-03-01T00:00:00Z",
          current_price_version_id: "ppv-1",
        },
      ],
      error: null,
    });
    sb.onTable("pass_price_versions", {
      data: [{ id: "ppv-1", unit_amount_paise: "20000" }],
      error: null,
    });

    const res = await passProductsRoute(get("/api/public/pass-products"));
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.source).toBe("db");
    const products = body.data.products as Array<Record<string, unknown>>;
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: PRODUCT_ID_SAFE,
      isBasePass: true,
      amountPaise: 20000,
      currency: "INR",
      salesState: "OPEN",
    });
  });

  it("returns both Basic and VIP Delegate passes when multiple exist", async () => {
    sb.onTable("pass_products", {
      data: [
        {
          id: PRODUCT_ID_SAFE,
          slug: "base-delegate-pass",
          name: "Basic Pass",
          description: "5-day access",
          is_base_pass: true,
          sales_state: "OPEN",
          valid_from: "2026-09-01T00:00:00Z",
          valid_until: "2027-03-01T00:00:00Z",
          current_price_version_id: "ppv-1",
        },
        {
          id: "prod-vip-delegate",
          slug: "vip-delegate-pass",
          name: "All-Access Delegate Pass",
          description: "Full concert & VIP access",
          is_base_pass: false,
          sales_state: "OPEN",
          valid_from: "2026-09-01T00:00:00Z",
          valid_until: "2027-03-01T00:00:00Z",
          current_price_version_id: "ppv-2",
        },
      ],
      error: null,
    });
    sb.onTable("pass_price_versions", {
      data: [
        { id: "ppv-1", unit_amount_paise: "20000" },
        { id: "ppv-2", unit_amount_paise: "200000" },
      ],
      error: null,
    });

    const res = await passProductsRoute(get("/api/public/pass-products"));
    const body = await json(res);
    expectOkEnvelope(body);
    const products = body.data.products as Array<Record<string, unknown>>;
    expect(products).toHaveLength(2);
    expect(products[0].amountPaise).toBe(20000);
    expect(products[1].amountPaise).toBe(200000);
    expect(products[1].slug).toBe("vip-delegate-pass");
  });

  it("maps a DB failure to a controlled INTERNAL error", async () => {
    sb.onTable("pass_products", {
      data: null,
      error: { message: "relation missing" },
    });

    const res = await passProductsRoute(get("/api/public/pass-products"));
    expect(res.status).toBe(500);
    const body = await json(res);
    expectErrEnvelope(body, "INTERNAL");
  });
});

/** Route context helper local to this file (avoids a shared generic export). */
function ctxOf(slug: string): { params: Promise<{ slug: string }> } {
  return { params: Promise.resolve({ slug }) };
}
