import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_ID, FESTIVAL_ID, resetWorld, sb, userSb, USER_ID } from "./helpers/mocks";
import { get, post, json, expectOkEnvelope, ctx } from "./helpers/requests";

const PRODUCT_ID = "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d";

vi.mock("@/lib/supabase/service-role", async () => {
  const m = await import("./helpers/mocks");
  return { createServiceRoleClient: () => m.sb };
});

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("./helpers/mocks");
  return {
    createServerSupabase: async () => m.userSb,
    createAdminSupabase: async () => m.userSb,
  };
});

vi.mock("@/lib/redis/rate-limits", async () => {
  const m = await import("./helpers/mocks");
  return {
    checkRateLimit: m.rateLimiter.checkRateLimit.bind(m.rateLimiter),
    enforceRateLimit: m.rateLimiter.enforceRateLimit.bind(m.rateLimiter),
  };
});

vi.mock("@/lib/razorpay/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/razorpay/client")>();
  const m = await import("./helpers/mocks");
  return { ...actual, getRazorpay: () => m.rzp };
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

import { GET as publicMerchList } from "@/app/api/public/merchandise/route";
import { GET as publicMerchBySlug } from "@/app/api/public/merchandise/[slug]/route";
import { POST as checkoutMerchRoute } from "@/app/api/checkout/merchandise/route";
import { GET as adminMerchList, POST as adminCreateMerch } from "@/app/api/admin/merchandise/route";
import { PATCH as adminPatchMerch } from "@/app/api/admin/merchandise/[id]/route";

function grantRead(permission = true): void {
  sb.onTable("festivals", { data: { id: FESTIVAL_ID }, error: null });
  userSb.setActor({ id: ADMIN_ID, email: "admin@example.com", confirmed: true });
  userSb.onRpc("has_permission", { data: permission, error: null });
}

function grantWrite(permission = true): void {
  grantRead(permission);
}

function grantUser(): void {
  sb.onTable("festivals", { data: { id: FESTIVAL_ID, status: "PUBLISHED" }, error: null });
  sb.onTable("feature_flags", { data: { value: { enabled: false } }, error: null }); // maintenance flag
  userSb.setActor({ id: USER_ID, email: "user@example.com", confirmed: true });
}

beforeAll(() => {
  vi.useFakeTimers();
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.advanceTimersByTime(31_000);
  resetWorld({ actor: { id: USER_ID, email: "user@example.com", confirmed: true } });
});

describe("GET /api/public/merchandise", () => {
  it("serves published merchandise items with calculated available units", async () => {
    sb.onTable("festivals", { data: { id: FESTIVAL_ID, status: "PUBLISHED" }, error: null });
    sb.onTable("merchandise_products", {
      data: [
        {
          id: PRODUCT_ID,
          slug: "tarang-hoodie",
          name: "TARANG Hoodie",
          tagline: "Official Apparel",
          description: "380 GSM heavyweight cotton hoodie",
          details_markdown: "100% French Terry Cotton",
          category: "Apparel",
          price_paise: "149900",
          currency: "INR",
          images: [
            "https://example.com/h1.jpg",
            "https://example.com/h2.jpg",
            "https://example.com/h3.jpg",
            "https://example.com/h4.jpg",
            "https://example.com/h5.jpg",
          ],
          sizes: ["S", "M", "L", "XL", "XXL"],
          stock_units: 100,
          held_units: 5,
          confirmed_units: 15,
          sales_state: "OPEN",
          status: "PUBLISHED",
          featured: true,
          sort_order: 1,
        },
      ],
      error: null,
    });

    const res = await publicMerchList(get("/api/public/merchandise"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.merchandise).toHaveLength(1);
    expect(body.data.merchandise[0]).toMatchObject({
      id: PRODUCT_ID,
      slug: "tarang-hoodie",
      name: "TARANG Hoodie",
      pricePaise: 149900,
      stockUnits: 100,
      availableUnits: 80,
    });
    expect(body.data.merchandise[0].images).toHaveLength(5);
  });
});

describe("GET /api/public/merchandise/:slug", () => {
  it("returns single product by slug", async () => {
    sb.onTable("festivals", { data: { id: FESTIVAL_ID, status: "PUBLISHED" }, error: null });
    sb.onTable("merchandise_products", {
      data: {
        id: PRODUCT_ID,
        slug: "tarang-hoodie",
        name: "TARANG Hoodie",
        tagline: "Official Apparel",
        description: "380 GSM heavyweight cotton hoodie",
        details_markdown: "100% French Terry Cotton",
        category: "Apparel",
        price_paise: "149900",
        currency: "INR",
        images: [
          "https://example.com/h1.jpg",
          "https://example.com/h2.jpg",
          "https://example.com/h3.jpg",
          "https://example.com/h4.jpg",
          "https://example.com/h5.jpg",
        ],
        sizes: ["S", "M", "L", "XL", "XXL"],
        stock_units: 100,
        held_units: 5,
        confirmed_units: 15,
        sales_state: "OPEN",
        status: "PUBLISHED",
        featured: true,
        sort_order: 1,
      },
      error: null,
    });

    const res = await publicMerchBySlug(
      get("/api/public/merchandise/tarang-hoodie"),
      ctx({ slug: "tarang-hoodie" })
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.merchandise.slug).toBe("tarang-hoodie");
    expect(body.data.merchandise.images).toHaveLength(5);
  });

  it("404s an unknown product slug", async () => {
    sb.onTable("festivals", { data: { id: FESTIVAL_ID, status: "PUBLISHED" }, error: null });
    sb.onTable("merchandise_products", { data: [], error: null });

    const res = await publicMerchBySlug(
      get("/api/public/merchandise/unknown-slug"),
      ctx({ slug: "unknown-slug" })
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /api/checkout/merchandise", () => {
  it("creates merchandise order and holds stock via RPC", async () => {
    grantUser();
    sb.onRpc("create_merchandise_checkout", {
      data: { orderId: "o-merch-1", replayed: false, amountPaise: 299800 },
      error: null,
    });
    sb.onTable("orders", {
      data: {
        id: "o-merch-1",
        public_order_code: "PO-MERCH01",
        checkout_state: "PROVISIONING_PROVIDER",
        amount_paise: 299800,
        currency: "INR",
        hold_expires_at: "2027-02-25T10:15:00Z",
      },
      error: null,
    });
    sb.onRpc("attach_razorpay_order", { data: null, error: null });
    sb.onTable("orders", {
      data: {
        id: "o-merch-1",
        public_order_code: "PO-MERCH01",
        checkout_state: "PROVISIONING_PROVIDER",
        amount_paise: 299800,
        currency: "INR",
        hold_expires_at: "2027-02-25T10:15:00Z",
      },
      error: null,
    });
    sb.onTable("razorpay_orders", {
      data: { razorpay_order_id: "order_rzp_mock" },
      error: null,
    });

    const res = await checkoutMerchRoute(
      post("/api/checkout/merchandise", {
        headers: { "idempotency-key": "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d" },
        body: {
          productId: PRODUCT_ID,
          selectedSize: "XL",
          quantity: 2,
          recipientName: "Aarav Sharma",
          recipientPhone: "+919876543210",
          recipientEmail: "aarav@example.com",
          deliveryMode: "PICKUP",
        },
      })
    );

    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.localOrderId).toBe("o-merch-1");
    expect(body.data.amountPaise).toBe(299800);
  });
});

describe("Admin Merchandise API Routes", () => {
  it("GET /api/admin/merchandise returns paginated items", async () => {
    grantRead();
    userSb.onTable("merchandise_products", {
      data: [
        {
          id: PRODUCT_ID,
          slug: "tarang-hoodie",
          name: "TARANG Hoodie",
          tagline: "",
          description: "380 GSM fleece",
          details_markdown: null,
          category: "Apparel",
          price_paise: "149900",
          images: ["https://example.com/h1.jpg"],
          sizes: ["S", "M", "L"],
          stock_units: 50,
          held_units: 2,
          confirmed_units: 8,
          sales_state: "OPEN",
          status: "PUBLISHED",
          featured: true,
          sort_order: 1,
          version: 1,
          created_at: "2026-08-01T00:00:00Z",
        },
      ],
      error: null,
      count: 1,
    });

    const res = await adminMerchList(get("/api/admin/merchandise"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
    expect(body.data.merchandise).toHaveLength(1);
    expect(body.data.merchandise[0].availableUnits).toBe(40);
  });

  it("POST /api/admin/merchandise creates product through RPC", async () => {
    grantWrite();
    userSb.onRpc("admin_upsert_merchandise", {
      data: { id: PRODUCT_ID, version: 1 },
      error: null,
    });

    const res = (await adminCreateMerch(
      post("/api/admin/merchandise", {
        body: {
          name: "TARANG Bomber Jacket",
          slug: "tarang-bomber-jacket",
          tagline: "Limited Drop",
          description: "Custom embroidered satin bomber jacket.",
          category: "Apparel",
          priceRupees: 2499,
          images: [
            "https://example.com/b1.jpg",
            "https://example.com/b2.jpg",
            "https://example.com/b3.jpg",
            "https://example.com/b4.jpg",
          ],
          sizes: ["M", "L", "XL"],
          stockUnits: 75,
          salesState: "OPEN",
          status: "PUBLISHED",
          featured: true,
          sortOrder: 1,
          version: 0,
        },
      })
    )) as Response;

    expect(res.status).toBe(201);
    const body = await json(res);
    expectOkEnvelope(body);
  });

  it("PATCH /api/admin/merchandise/:id updates product", async () => {
    grantWrite();
    userSb.onRpc("admin_upsert_merchandise", {
      data: { id: PRODUCT_ID, version: 2 },
      error: null,
    });

    const res = (await adminPatchMerch(
      post(`/api/admin/merchandise/${PRODUCT_ID}`, {
        body: {
          name: "TARANG Bomber Jacket Updated",
          slug: "tarang-bomber-jacket",
          tagline: "Limited Drop",
          description: "Updated description.",
          category: "Apparel",
          priceRupees: 2799,
          images: ["https://example.com/b1.jpg"],
          sizes: ["L", "XL"],
          stockUnits: 80,
          salesState: "OPEN",
          status: "PUBLISHED",
          featured: true,
          sortOrder: 1,
          version: 1,
        },
      }),
      ctx({ id: PRODUCT_ID })
    )) as Response;

    expect(res.status).toBe(200);
    const body = await json(res);
    expectOkEnvelope(body);
  });
});
