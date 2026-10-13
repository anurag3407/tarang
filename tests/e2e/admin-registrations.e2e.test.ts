import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_ID,
  FESTIVAL_ID,
  resetWorld,
  sb,
  userSb,
} from "./helpers/mocks";
import {
  get,
  json,
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

import { GET as adminRegistrationsRoute } from "@/app/api/admin/registrations/route";
import { GET as adminOverviewRoute } from "@/app/api/admin/overview/route";

const EVENT_ID = "73dfaf12-e79d-4415-8fa5-2063d066aeeb";
const REG_ID = "b9c9012d-815f-4b9a-819b-1f06c1a87f08";

describe("Admin Registrations and Paginated Overview", () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.advanceTimersByTime(31_000);
    resetWorld({ actor: { id: ADMIN_ID, email: "admin@example.com", confirmed: true } });
    userSb.setActor({ id: ADMIN_ID, email: "admin@example.com", confirmed: true });
    sb.onTable("festivals", { data: { id: FESTIVAL_ID, slug: "pulse-2026", status: "PUBLISHED" }, error: null });
    userSb.onTable("festivals", {
      data: [{ id: FESTIVAL_ID, slug: "pulse-2026", status: "PUBLISHED" }],
      error: null,
    });
  });

  describe("GET /api/admin/registrations", () => {
    it("rejects non-admin access without permissions", async () => {
      userSb.onRpc("has_permission", { data: false, error: null });
      const req = get("/api/admin/registrations");
      const res = await adminRegistrationsRoute(req);
      const envelope = await json(res);
      expectErrEnvelope(envelope, "FORBIDDEN");
    });

    it("returns paginated event registrations for authorized admin", async () => {
      userSb.onRpc("has_permission", { data: true, error: null });

      sb.onTable("registrations", {
        data: [
          {
            id: REG_ID,
            public_registration_code: "PR-TEST01",
            registration_mode: "INDIVIDUAL",
            team_name: null,
            capacity_units: 1,
            state: "CONFIRMED",
            confirmed_at: "2026-09-01T10:00:00Z",
            created_at: "2026-09-01T09:59:00Z",
            owner_user_id: "u-part1",
            events: {
              id: EVENT_ID,
              name: "Battle of the Bands",
              slug: "battle-bands",
              festival_id: FESTIVAL_ID,
              categories: { name: "Music" },
              venues: { name: "Main Stage" },
            },
            order_lines: {
              id: "ol-1",
              line_amount_paise: 50000,
              orders: {
                id: "ord-1",
                public_order_code: "PO-MUSIC01",
                checkout_state: "FULFILLED",
              },
            },
            registration_members: [
              {
                role: "INDIVIDUAL",
                user_id: "u-part1",
              },
            ],
          },
        ],
        count: 1,
        error: null,
      });

      sb.onTable("profiles", {
        data: [
          {
            user_id: "u-part1",
            display_name: "Alice Johnson",
            phone_e164: "+919876543210",
            college_name: "AIIMS Delhi",
            public_member_code: "MEM-ALICE",
          },
        ],
        error: null,
      });

      const req = get("/api/admin/registrations?page=1&pageSize=25");
      const res = await adminRegistrationsRoute(req);
      const envelope = await json(res);
      expectOkEnvelope(envelope);

      expect(envelope.data.total).toBe(1);
      expect(envelope.data.page).toBe(1);
      expect(envelope.data.items).toHaveLength(1);
      expect(envelope.data.items[0].publicRegistrationCode).toBe("PR-TEST01");
      expect(envelope.data.items[0].event.name).toBe("Battle of the Bands");
      expect(envelope.data.items[0].registrant.name).toBe("Alice Johnson");
      expect(envelope.data.items[0].registrant.college).toBe("AIIMS Delhi");
    });
  });

  describe("GET /api/admin/overview", () => {
    it("returns accurate global metrics across all festival records", async () => {
      userSb.onRpc("has_permission", { data: true, error: null });

      sb.onTable(
        "orders",
        // The paged revenue scan starts before the count queries resolve, so
        // it consumes the first queued response.
        {
          data: [
            {
              amount_paise: 300000,
              kind: "BASE_PASS",
              order_lines: [{ pass_products: { slug: "vip-delegate-pass", name: "Pronite Pass", is_base_pass: false } }],
            },
            {
              amount_paise: 20000,
              kind: "BASE_PASS",
              order_lines: [{ pass_products: { slug: "base-delegate-pass", name: "Basic Card", is_base_pass: true } }],
            },
            { amount_paise: 60000, kind: "EVENT", order_lines: [{ pass_products: null }] },
          ],
          error: null,
        }, // all fulfilled orders for revenue, classified by product (not price)
        { count: 3, error: null }, // total count
        { count: 3, error: null }, // fulfilled count
        { count: 0, error: null }, // refunded count
        { count: 0, error: null }, // pending count
        {
          data: [
            {
              id: "ord-1",
              public_order_code: "PO-1",
              purchaser_user_id: "u1",
              amount_paise: 300000,
              currency: "INR",
              kind: "BASE_PASS",
              checkout_state: "FULFILLED",
              fulfilled_at: "2026-09-01T10:00:00Z",
              created_at: "2026-09-01T10:00:00Z",
            },
          ],
          error: null,
        } // 6. page 1 orders
      );

      sb.onTable("delegate_passes", {
        data: [
          {
            id: "p1",
            public_pass_code: "PP-VIP01",
            user_id: "u1",
            state: "ACTIVE",
            pass_products: { slug: "vip-delegate-pass", is_base_pass: false },
          },
          {
            id: "p2",
            public_pass_code: "PP-BAS01",
            user_id: "u2",
            state: "ACTIVE",
            pass_products: { slug: "basic-pass", is_base_pass: true },
          },
        ],
        count: 2,
        error: null,
      });

      sb.onTable("registrations", {
        data: [],
        count: 5,
        error: null,
      });

      sb.onTable("profiles", {
        data: [],
        count: 12,
        error: null,
      });

      sb.onTable("group_entries", {
        data: [],
        count: 2,
        error: null,
      });

      const req = get("/api/admin/overview");
      const res = await adminOverviewRoute(req);
      const envelope = await json(res);
      expectOkEnvelope(envelope);

      expect(envelope.data.metrics.grossRevenuePaise).toBe(380000);
      expect(envelope.data.metrics.delegatePassRevenuePaise).toBe(300000);
      expect(envelope.data.metrics.basicPassRevenuePaise).toBe(20000);
      expect(envelope.data.metrics.eventsRevenuePaise).toBe(60000);
      expect(envelope.data.metrics.delegatePassesCount).toBe(1);
      expect(envelope.data.metrics.basicPassesCount).toBe(1);
      expect(envelope.data.ordersPagination).toBeDefined();
      expect(envelope.data.passesPagination).toBeDefined();
      expect(envelope.data.registrationsPagination).toBeDefined();
    });

    it("handles tab querying for ?tab=registrations with pagination", async () => {
      userSb.onRpc("has_permission", { data: true, error: null });

      sb.onTable("registrations", {
        data: [
          {
            id: REG_ID,
            public_registration_code: "PR-TEST02",
            registration_mode: "TEAM",
            team_name: "Code Warriors",
            capacity_units: 4,
            state: "CONFIRMED",
            confirmed_at: "2026-09-02T10:00:00Z",
            created_at: "2026-09-02T09:59:00Z",
            owner_user_id: "u-lead",
            events: {
              id: EVENT_ID,
              name: "Hackathon",
              slug: "hackathon",
              festival_id: FESTIVAL_ID,
              categories: { name: "Tech" },
              venues: { name: "Lab 3" },
            },
            order_lines: null,
            registration_members: [],
          },
        ],
        count: 1,
        error: null,
      });

      sb.onTable("profiles", {
        data: [
          {
            user_id: "u-lead",
            display_name: "Team Lead",
            phone_e164: "+919876543211",
            college_name: "IIT Delhi",
            public_member_code: "MEM-LEAD",
          },
        ],
        error: null,
      });

      const req = get("/api/admin/overview?tab=registrations&page=1&pageSize=25");
      const res = await adminOverviewRoute(req);
      const envelope = await json(res);
      expectOkEnvelope(envelope);

      expect(envelope.data.total).toBe(1);
      expect(envelope.data.items[0].publicRegistrationCode).toBe("PR-TEST02");
      expect(envelope.data.items[0].teamName).toBe("Code Warriors");
      expect(envelope.data.items[0].event.name).toBe("Hackathon");
    });
  });
});
