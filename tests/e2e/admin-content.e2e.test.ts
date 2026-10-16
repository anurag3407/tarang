import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  EVENT_ID,
  FESTIVAL_ID,
  revalidateLog,
  resetWorld,
  sb,
  userSb,
} from "./helpers/mocks";
import {
  ctx,
  get,
  json,
  post,
  expectOkEnvelope,
  expectErrEnvelope,
} from "./helpers/requests";

vi.mock("@/lib/supabase/service-role", async () => {
  const m = await import("./helpers/mocks");
  return { createServiceRoleClient: () => m.sb };
});
vi.mock("@/lib/supabase/server", async () => {
  const m = await import("./helpers/mocks");
  return { createServerSupabase: async () => m.userSb };
});
vi.mock("@/lib/redis/rate-limits", async () => {
  const m = await import("./helpers/mocks");
  return {
    checkRateLimit: m.rateLimiter.checkRateLimit.bind(m.rateLimiter),
    enforceRateLimit: m.rateLimiter.enforceRateLimit.bind(m.rateLimiter),
  };
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

import { GET as adminEventsList, POST as adminCreateEvent } from "@/app/api/admin/events/route";
import { GET as adminGetEvent, PATCH as adminPatchEvent } from "@/app/api/admin/events/[id]/route";
import { POST as adminSetPrice } from "@/app/api/admin/events/[id]/price/route";
import { POST as adminSetCapacity } from "@/app/api/admin/events/[id]/capacity/route";
import { POST as adminPublishEvent } from "@/app/api/admin/events/[id]/publish/route";
import { POST as adminUnpublishEvent } from "@/app/api/admin/events/[id]/unpublish/route";
import { GET as adminNotices, POST as adminCreateNotice } from "@/app/api/admin/notices/route";
import { PATCH as adminPatchNotice } from "@/app/api/admin/notices/[id]/route";
import { GET as adminSchedule, POST as adminCreateSchedule } from "@/app/api/admin/schedule/route";
import { GET as adminPassProducts } from "@/app/api/admin/pass-products/route";
import { POST as adminSetPassPrice } from "@/app/api/admin/pass-products/[id]/price/route";

const CATEGORY_ID = "ca7e0f17-ca73-4ca3-8ca3-ca7e01d5ca13";
const VENUE_ID = "7e1209a3-3e12-4a32-8a32-7e1209a33e12";

function validEventBody(): Record<string, unknown> {
  return {
    slug: "robotics-clash",
    name: "Robotics Clash",
    shortDescription: "Bots battle it out.",
    description: "Build a bot, destroy the competition.",
    rulesMarkdown: null,
    categoryId: CATEGORY_ID,
    venueId: VENUE_ID,
    startsAt: "2027-02-25T10:00:00Z",
    endsAt: "2027-02-25T13:00:00Z",
    includeInSchedule: true,
    isNightEvent: false,
    registrationMode: "INDIVIDUAL",
    capacityBasis: "PARTICIPANT",
    priceBasis: "PARTICIPANT",
    minTeamSize: 1,
    maxTeamSize: 1,
    capacityUnits: 50,
    priceRupees: 250.5,
    prizePoolText: "",
    registrationOpensAt: "2026-09-01T00:00:00Z",
    registrationClosesAt: "2027-02-20T00:00:00Z",
    featured: false,
    version: 1,
  };
}

/** Read guard prelude: permission + admin limiter. */
function grantRead(permission = true): void {
  sb.onTable("festivals", { data: { id: FESTIVAL_ID }, error: null });
  userSb.setActor({ id: ADMIN_ID, email: "admin@example.com", confirmed: true });
  userSb.onRpc("has_permission", { data: permission, error: null });
}

function grantWrite(permission = true): void {
  grantRead(permission);
}

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld({ actor: { id: ADMIN_ID, email: "admin@example.com", confirmed: true } });
});

describe("GET /api/admin/events (plan §11.6)", () => {
  function seedListRows(): void {
    userSb.onTable("events", {
      data: [
        {
          id: EVENT_ID,
          slug: "robotics-clash",
          name: "Robotics Clash",
          status: "PUBLISHED",
          sales_state: "OPEN",
          featured: true,
          image_url: "https://example.com/robotics.jpg",
          version: 3,
          starts_at: "2027-02-25T10:00:00Z",
          registration_mode: "INDIVIDUAL",
          capacity_basis: "PARTICIPANT",
          price_basis: "PARTICIPANT",
          current_price_version_id: "pv-9",
          categories: [{ name: "Tech" }],
          event_inventory: [{ capacity_units: 100, held_units: 10, confirmed_units: 40 }],
        },
      ],
      error: null,
      count: 1,
    });
    userSb.onTable("event_price_versions", {
      data: [{ id: "pv-9", unit_amount_paise: "25050" }],
      error: null,
    });
  }

  it("returns paginated events with joined price + inventory", async () => {
    grantRead();
    seedListRows();

    const res = await adminEventsList(get("/api/admin/events"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.page).toBe(1);
    expect(body.data.pageSize).toBe(20);
    expect(body.data.total).toBe(1);
    expect((body.data.events as Array<Record<string, unknown>>)[0]).toMatchObject({
      id: EVENT_ID,
      amountPaise: 25050,
      categoryName: "Tech",
      imageUrl: "https://example.com/robotics.jpg",
      version: 3,
      inventory: { capacityUnits: 100, heldUnits: 10, confirmedUnits: 40 },
    });
    // Range window derived from pagination defaults.
    expect(userSb.callsFor("events")[0].filters["range"]).toEqual([0, 19]);
  });

  it("applies search/status/pagination params to the query", async () => {
    grantRead();
    seedListRows();

    await adminEventsList(get("/api/admin/events?q=robot&status=PUBLISHED&page=2&pageSize=5"));
    const call = userSb.callsFor("events")[0];
    expect(call.filters["name:ilike"]).toBe("%robot%");
    expect(call.filters["status"]).toBe("PUBLISHED");
    expect(call.filters["range"]).toEqual([5, 9]);
  });

  it("403s without content.event.read", async () => {
    grantRead(false);

    const res = await adminEventsList(get("/api/admin/events"));
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });
});

describe("POST /api/admin/events (plan §11.6)", () => {
  it("creates an event through the SQL RPC with rupee->paise conversion", async () => {
    grantWrite();
    userSb.onRpc("admin_upsert_event", { data: { id: EVENT_ID, version: 1 }, error: null });

    const res = await adminCreateEvent(
      post("/api/admin/events", { body: validEventBody() })
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.event).toEqual({ id: EVENT_ID, version: 1 });

    const rpc = userSb.rpcParams("admin_upsert_event")!;
    expect(rpc.p_price_paise).toBe(25050); // ₹250.50
    expect(rpc.p_slug).toBe("robotics-clash");
    expect(rpc.p_festival_id).toBe(FESTIVAL_ID);
    expect(rpc.p_capacity_units).toBe(50);
    expect(rpc.p_image_url).toBeNull();

    // Cache tags invalidated for both events + schedule kinds.
    expect(revalidateLog).toContain(`festival:${FESTIVAL_ID}:events`);
    expect(revalidateLog).toContain(`festival:${FESTIVAL_ID}:schedule`);
  });

  it("passes custom imageUrl to admin_upsert_event RPC", async () => {
    grantWrite();
    userSb.onRpc("admin_upsert_event", { data: { id: EVENT_ID, version: 1 }, error: null });

    const res = await adminCreateEvent(
      post("/api/admin/events", {
        body: {
          ...validEventBody(),
          imageUrl: "https://example.com/poster-1x1.jpg",
        },
      })
    );
    expect(res.status).toBe(201);
    const rpc = userSb.rpcParams("admin_upsert_event")!;
    expect(rpc.p_image_url).toBe("https://example.com/poster-1x1.jpg");
  });

  it.each([
    ["invalid slug characters", { ...validEventBody(), slug: "nope upper!!" }],
    ["inverted time window", { ...validEventBody(), startsAt: "2027-02-26T00:00:00Z", endsAt: "2027-02-25T00:00:00Z" }],
    ["team sizes on an individual event", { ...validEventBody(), minTeamSize: 2 }],
    ["absurd price", { ...validEventBody(), priceRupees: 1000001 }],
    ["unknown field", { ...validEventBody(), hackerField: true }],
  ] as const)("422s %s with issue details", async (_name, badBody) => {
    grantWrite();

    const res = await adminCreateEvent(post("/api/admin/events", { body: badBody }));
    expect(res.status).toBe(422);
    const body = await json(res);
    expectErrEnvelope(body, "VALIDATION_FAILED");
    expect(Array.isArray((body.details as { issues: unknown[] }).issues)).toBe(true);
    expect(userSb.callsFor("admin_upsert_event")).toHaveLength(0);
  });

  it.each([
    ["VERSION_CONFLICT", 409, "VERSION_CONFLICT"],
    ["STRUCTURE_LOCKED", 409, "CONFLICT"],
    ["CAPACITY_BELOW_COMMITTED", 409, "CAPACITY_BELOW_COMMITTED"],
    ["PUBLISH_INVALID", 422, "VALIDATION_FAILED"],
    ["FORBIDDEN", 403, "FORBIDDEN"],
    ["weird db failure", 500, "INTERNAL"],
  ] as const)("maps RPC error %s -> %s %s", async (rpcMessage, status, code) => {
    grantWrite();
    userSb.onRpc("admin_upsert_event", { data: null, error: { message: rpcMessage } });

    const res = await adminCreateEvent(post("/api/admin/events", { body: validEventBody() }));
    expect(res.status).toBe(status);
    expectErrEnvelope(await json(res), code);
  });
});

describe("PATCH /api/admin/events/:id — optimistic concurrency", () => {
  it("sends p_event_id and maps stale versions to a reload-and-retry 409", async () => {
    grantWrite();
    userSb.onRpc("admin_upsert_event", {
      data: null,
      error: { message: "Exception: VERSION_CONFLICT: expected v1 got v3" },
    });

    const res = await adminPatchEvent(
      post(`/api/admin/events/${EVENT_ID}`, { body: validEventBody() }),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(409);
    const body = await json(res);
    expectErrEnvelope(body, "VERSION_CONFLICT");
    expect(body.message).toMatch(/reload and retry/i);
    expect(userSb.rpcParams("admin_upsert_event")?.p_event_id).toBe(EVENT_ID);
  });

  it("returns the updated record on success and invalidates availability too", async () => {
    grantWrite();
    userSb.onRpc("admin_upsert_event", { data: { id: EVENT_ID, version: 2 }, error: null });

    const res = await adminPatchEvent(
      post(`/api/admin/events/${EVENT_ID}`, { body: validEventBody() }),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(200);
    expect(revalidateLog).toContain(`festival:${FESTIVAL_ID}:events`);
  });
});

describe("GET /api/admin/events/:id", () => {
  it("loads the full editable record", async () => {
    grantRead();
    userSb.onTable("events", {
      data: {
        id: EVENT_ID,
        slug: "robotics-clash",
        name: "Robotics Clash",
        short_description: null,
        description: null,
        rules_markdown: null,
        category_id: CATEGORY_ID,
        venue_id: null,
        starts_at: "2027-02-25T10:00:00Z",
        ends_at: null,
        is_night_event: false,
        registration_mode: "INDIVIDUAL",
        capacity_basis: "PARTICIPANT",
        price_basis: "PARTICIPANT",
        min_team_size: 1,
        max_team_size: 1,
        prize_pool_text: null,
        featured: false,
        image_url: "https://example.com/single-event.jpg",
        status: "DRAFT",
        sales_state: "CLOSED",
        registration_opens_at: null,
        registration_closes_at: null,
        version: 1,
        current_price_version_id: "pv-1",
        event_inventory: null,
      },
      error: null,
    });
    userSb.onTable("event_price_versions", { data: { unit_amount_paise: "15000" }, error: null });

    const res = await adminGetEvent(get(`/api/admin/events/${EVENT_ID}`), ctx({ id: EVENT_ID }));
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.event).toMatchObject({
      id: EVENT_ID,
      status: "DRAFT",
      amountPaise: 15000,
      imageUrl: "https://example.com/single-event.jpg",
      inventory: null,
    });
  });

  it("404s an unknown event id", async () => {
    grantRead();
    userSb.onTable("events", { data: null, error: null });

    const res = await adminGetEvent(get(`/api/admin/events/${EVENT_ID}`), ctx({ id: EVENT_ID }));
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });
});

describe("POST /api/admin/events/:id/price (plan §11.6)", () => {
  function seedCurrentEventRow(): void {
    userSb.onTable("events", {
      data: {
        slug: "robotics-clash",
        name: "Robotics Clash",
        short_description: null,
        description: null,
        rules_markdown: null,
        category_id: CATEGORY_ID,
        venue_id: null,
        starts_at: "2027-02-25T10:00:00Z",
        ends_at: null,
        is_night_event: false,
        include_in_schedule: true,
        registration_mode: "INDIVIDUAL",
        capacity_basis: "PARTICIPANT",
        price_basis: "PARTICIPANT",
        min_team_size: 1,
        max_team_size: 1,
        prize_pool_text: null,
        featured: false,
        registration_opens_at: null,
        registration_closes_at: null,
        event_inventory: [{ capacity_units: 50 }],
      },
      error: null,
    });
  }

  it("replays all existing fields through the RPC with a change reason", async () => {
    grantWrite();
    seedCurrentEventRow();
    userSb.onRpc("admin_upsert_event", { data: { id: EVENT_ID }, error: null });

    const res = await adminSetPrice(
      post(`/api/admin/events/${EVENT_ID}/price`, {
        body: { priceRupees: 300, reason: "Early-bird ended", version: 2 },
      }),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(200);
    const rpc = userSb.rpcParams("admin_upsert_event")!;
    expect(rpc.p_change_reason).toBe("Early-bird ended");
    expect(rpc.p_price_paise).toBe(30000);
    expect(rpc.p_expected_version).toBe(2);
    // Existing fields preserved, not nulled out:
    expect(rpc.p_name).toBe("Robotics Clash");
    expect(rpc.p_capacity_units).toBe(50);
  });

  it("404s an unknown event", async () => {
    grantWrite();
    userSb.onTable("events", { data: null, error: null });

    const res = await adminSetPrice(
      post(`/api/admin/events/${EVENT_ID}/price`, {
        body: { priceRupees: 300, reason: "Rate card refresh", version: 2 },
      }),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(404);
    expectErrEnvelope(await json(res), "NOT_FOUND");
  });

  it("422s a missing change reason (immutable audit)", async () => {
    grantWrite();

    const res = await adminSetPrice(
      post(`/api/admin/events/${EVENT_ID}/price`, {
        body: { priceRupees: 300, version: 2 },
      }),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });
});

describe("POST /api/admin/events/:id/capacity", () => {
  it("routes through the guarded conditional update", async () => {
    grantWrite();
    userSb.onRpc("admin_set_event_capacity", {
      data: { capacity_units: 120, held_units: 10, confirmed_units: 30 },
      error: null,
    });

    const res = await adminSetCapacity(
      post(`/api/admin/events/${EVENT_ID}/capacity`, {
        body: { capacityUnits: 120, version: 4 },
      }),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.inventory).toMatchObject({ capacity_units: 120 });
    expect(userSb.rpcParams("admin_set_event_capacity")).toMatchObject({
      p_event_id: EVENT_ID,
      p_new_capacity: 120,
      p_expected_version: 4,
    });
    expect(revalidateLog).toContain(`festival:${FESTIVAL_ID}:events`);
  });

  it("refuses reductions below committed registrations", async () => {
    grantWrite();
    userSb.onRpc("admin_set_event_capacity", {
      data: null,
      error: { message: "CAPACITY_BELOW_COMMITTED" },
    });

    const res = await adminSetCapacity(
      post(`/api/admin/events/${EVENT_ID}/capacity`, {
        body: { capacityUnits: 5, version: 4 },
      }),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(409);
    expectErrEnvelope(await json(res), "CAPACITY_BELOW_COMMITTED");
  });
});

describe("POST /api/admin/events/:id/publish (plan §11.6)", () => {
  it("publishes the event and invalidates cache", async () => {
    grantWrite();
    userSb.onRpc("admin_publish_event", {
      data: { id: EVENT_ID, status: "PUBLISHED", sales_state: "OPEN" },
      error: null,
    });

    const res = await adminPublishEvent(
      post(`/api/admin/events/${EVENT_ID}/publish`),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.event).toMatchObject({ id: EVENT_ID, status: "PUBLISHED" });
    expect(userSb.rpcParams("admin_publish_event")).toMatchObject({ p_event_id: EVENT_ID });
    expect(revalidateLog).toContain(`festival:${FESTIVAL_ID}:events`);
    expect(revalidateLog).toContain(`festival:${FESTIVAL_ID}:schedule`);
  });

  it("maps missing price/inventory errors", async () => {
    grantWrite();
    userSb.onRpc("admin_publish_event", {
      data: null,
      error: { message: "PUBLISH_INVALID missing price version" },
    });

    const res = await adminPublishEvent(
      post(`/api/admin/events/${EVENT_ID}/publish`),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });
});

describe("POST /api/admin/events/:id/unpublish (plan §11.6)", () => {
  it("unpublishes the event back to draft status and invalidates cache", async () => {
    grantWrite();
    userSb.onRpc("admin_unpublish_event", {
      data: { id: EVENT_ID, status: "DRAFT", sales_state: "DRAFT" },
      error: null,
    });

    const res = await adminUnpublishEvent(
      post(`/api/admin/events/${EVENT_ID}/unpublish`),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.event).toMatchObject({ id: EVENT_ID, status: "DRAFT", sales_state: "DRAFT" });
    expect(userSb.rpcParams("admin_unpublish_event")).toMatchObject({ p_event_id: EVENT_ID });
    expect(revalidateLog).toContain(`festival:${FESTIVAL_ID}:events`);
    expect(revalidateLog).toContain(`festival:${FESTIVAL_ID}:schedule`);
  });

  it("403s when content.event.publish permission is missing", async () => {
    grantRead(false);

    const res = await adminUnpublishEvent(
      post(`/api/admin/events/${EVENT_ID}/unpublish`),
      ctx({ id: EVENT_ID })
    );
    expect(res.status).toBe(403);
    expectErrEnvelope(await json(res), "FORBIDDEN");
  });
});

describe("admin notices (plan §11.8)", () => {
  it("creates a notice and invalidates only notice caches", async () => {
    grantWrite();
    userSb.onRpc("admin_upsert_notice", { data: { id: "notice-1" }, error: null });

    const res = await adminCreateNotice(
      post("/api/admin/notices", {
        body: {
          slug: "day-1-gates",
          tag: "URGENT",
          title: "Gates open 8 AM",
          bodyMarkdown: "Bring your QR.",
          publishAt: "2027-02-24T06:00:00Z",
          expiresAt: null,
          pinned: false,
          version: 1,
        },
      })
    );
    expect(res.status).toBe(201);
    expect(userSb.rpcParams("admin_upsert_notice")).toMatchObject({
      p_notice_id: null,
      p_tag: "URGENT",
      p_title: "Gates open 8 AM",
    });
    expect(revalidateLog).toEqual([`festival:${FESTIVAL_ID}:notices`]);
  });

  it("422s a bad tag enum", async () => {
    grantWrite();

    const res = await adminCreateNotice(
      post("/api/admin/notices", {
        body: {
          slug: "x-slug",
          tag: "SHOUTING",
          title: "Valid title",
          bodyMarkdown: "body",
          publishAt: "2027-02-24T06:00:00Z",
          expiresAt: null,
          pinned: false,
          version: 1,
        },
      })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });

  it("PATCHes an existing notice with its id", async () => {
    grantWrite();
    userSb.onRpc("admin_upsert_notice", { data: { id: "09090909-0909-4909-8909-090909090909" }, error: null });

    const res = await adminPatchNotice(
      post("/api/admin/notices/notice-9", {
        body: {
          slug: "day-1-gates",
          tag: "URGENT",
          title: "Gates now open 7:30 AM",
          bodyMarkdown: "Earlier entry.",
          publishAt: "2027-02-24T06:00:00Z",
          expiresAt: null,
          pinned: true,
          version: 2,
        },
      }),
      ctx({ id: "09090909-0909-4909-8909-090909090909" })
    );
    expect(res.status).toBe(200);
    expect(userSb.rpcParams("admin_upsert_notice")?.p_notice_id).toBe("09090909-0909-4909-8909-090909090909");
  });

  it("lists every notice including drafts for editors", async () => {
    grantWrite();
    userSb.onTable("notices", {
      data: [
        {
          id: "notice-1",
          slug: "a",
          tag: "URGENT",
          title: "A",
          body_markdown: "b",
          publish_at: "2027-02-24T06:00:00Z",
          expires_at: null,
          pinned: false,
          status: "SCHEDULED",
          version: 1,
        },
      ],
      error: null,
    });

    const res = await adminNotices(get("/api/admin/notices"));
    const body = await json(res);
    expectOkEnvelope(body);
    expect((body.data.notices as Array<{ status: string }>)[0].status).toBe("SCHEDULED");
  });
});

describe("admin schedule (plan §11.7)", () => {
  it("creates a schedule entry and surfaces SQL conflicts", async () => {
    grantWrite();
    userSb.onRpc("admin_upsert_schedule_entry", { data: { id: "entry-1" }, error: null });

    const okRes = await adminCreateSchedule(
      post("/api/admin/schedule", {
        body: {
          linkedEventId: EVENT_ID,
          title: "Hackathon kickoff",
          venueId: VENUE_ID,
          startsAt: "2027-02-25T10:00:00Z",
          endsAt: "2027-02-25T13:00:00Z",
          categoryKey: "tech",
          isNight: false,
          dayTheme: null,
          version: 1,
        },
      })
    );
    expect(okRes.status).toBe(201);
    const rpc = userSb.rpcParams("admin_upsert_schedule_entry")!;
    expect(rpc).toMatchObject({ p_linked_event_id: EVENT_ID, p_category_key: "tech" });
    expect(revalidateLog).toEqual([`festival:${FESTIVAL_ID}:schedule`]);

    // Venue/time overlap detection happens in SQL.
    userSb.reset();
    grantWrite();
    userSb.onRpc("admin_upsert_schedule_entry", {
      data: null,
      error: { message: "SCHEDULE_CONFLICT: overlaps opening ceremony" },
    });
    const conflictRes = await adminCreateSchedule(
      post("/api/admin/schedule", {
        body: {
          linkedEventId: EVENT_ID,
          title: "Overlapping",
          venueId: VENUE_ID,
          startsAt: "2027-02-25T10:00:00Z",
          endsAt: "2027-02-25T13:00:00Z",
          categoryKey: "tech",
          isNight: false,
          dayTheme: null,
          version: 1,
        },
      })
    );
    expect(conflictRes.status).toBe(409);
    expectErrEnvelope(await json(conflictRes), "CONFLICT");
  });

  it("lists entries with linked event + venue names", async () => {
    grantWrite();
    userSb.onTable("schedule_entries", {
      data: [
        {
          id: "se-1",
          linked_event_id: EVENT_ID,
          title: null,
          starts_at: "2027-02-25T10:00:00Z",
          ends_at: "2027-02-25T13:00:00Z",
          category_key: "tech",
          is_night: false,
          day_theme: "Build Day",
          status: "PUBLISHED",
          version: 1,
          venue_id: VENUE_ID,
          sort_order: 2,
          venues: [{ name: "Innovation Lab" }],
          events: [{ name: "Hackathon", slug: "hackathon" }],
        },
      ],
      error: null,
    });

    const res = await adminSchedule(get("/api/admin/schedule"));
    const body = await json(res);
    expectOkEnvelope(body);
    expect((body.data.entries as Array<Record<string, unknown>>)[0]).toMatchObject({
      linkedEventName: "Hackathon",
      venueName: "Innovation Lab",
      sortOrder: 2,
    });
  });

  it("422s standalone entries without a title", async () => {
    grantWrite();

    const res = await adminCreateSchedule(
      post("/api/admin/schedule", {
        body: {
          linkedEventId: null,
          venueId: VENUE_ID,
          startsAt: "2027-02-25T10:00:00Z",
          endsAt: "2027-02-25T13:00:00Z",
          categoryKey: "tech",
          isNight: false,
          dayTheme: null,
          version: 1,
        },
      })
    );
    expect(res.status).toBe(422);
    expectErrEnvelope(await json(res), "VALIDATION_FAILED");
  });
});

describe("GET /api/admin/pass-products (dynamic pricing)", () => {
  it("loads pass products with price versioning history", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    userSb.onTable("pass_products", {
      data: [
        {
          id: "de1e9a7e-de1e-4de1-8de1-de1e9a7ede1e",
          slug: "vip-delegate-pass",
          name: "All-Access Delegate Pass",
          description: "Full concert and VIP pass",
          is_base_pass: false,
          sales_state: "OPEN",
          valid_from: "2027-02-24T00:00:00Z",
          valid_until: "2027-03-01T00:00:00Z",
          status: "PUBLISHED",
          current_price_version_id: "ppv-1",
          updated_at: "2027-02-01T00:00:00Z",
        },
      ],
      error: null,
    });
    userSb.onTable("pass_price_versions", {
      data: [
        {
          id: "ppv-1",
          pass_product_id: "de1e9a7e-de1e-4de1-8de1-de1e9a7ede1e",
          version: 1,
          unit_amount_paise: 200000,
          change_reason: "initial price ₹2000",
          created_at: "2027-02-01T00:00:00Z",
        },
      ],
      error: null,
    });

    const res = await adminPassProducts(get("/api/admin/pass-products"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    const products = body.data.products as Array<Record<string, unknown>>;
    expect(products).toHaveLength(1);
    expect(products[0].currentPricePaise).toBe(200000);
    expect(products[0].slug).toBe("vip-delegate-pass");
  });
});

describe("POST /api/admin/pass-products/:id/price (dynamic pricing update)", () => {
  it("creates a new price version for the delegate pass", async () => {
    userSb.onRpc("has_permission", { data: true, error: null });
    sb.onTable("pass_products", {
      data: {
        id: "de1e9a7e-de1e-4de1-8de1-de1e9a7ede1e",
        name: "All-Access Delegate Pass",
        festival_id: FESTIVAL_ID,
        current_price_version_id: "ppv-1",
      },
      error: null,
    });
    sb.onTable("pass_price_versions", {
      data: { version: 1 },
      error: null,
    });
    sb.onTable("pass_price_versions", {
      data: {
        id: "ppv-2",
        version: 2,
        unit_amount_paise: 250000,
        change_reason: "Late registration price bump",
        created_at: new Date().toISOString(),
      },
      error: null,
    });
    sb.onTable("pass_products", {
      data: null,
      error: null,
    });

    const res = await adminSetPassPrice(
      post("/api/admin/pass-products/prod-delegate-1/price", {
        body: { priceRupees: 2500, reason: "Late registration price bump" },
      }),
      ctx({ id: "de1e9a7e-de1e-4de1-8de1-de1e9a7ede1e" })
    );

    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.product).toMatchObject({
      currentPricePaise: 250000,
      currentPriceVersion: 2,
    });
  });
});

