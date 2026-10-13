import { describe, expect, it } from "vitest";
import {
  basePassCheckoutSchema,
  eventAdminSchema,
  eventCheckoutSchema,
  eventPriceSchema,
  idempotencyKeySchema,
  razorpayVerifySchema,
  merchandiseAdminSchema,
  merchandiseCheckoutSchema,
  sponsorAdminSchema,
  supportQuestionSchema,
  verifyQuerySchema,
} from "@/lib/validation/schemas";

describe("checkout request schemas — the browser never sends money", () => {
  it("base-pass checkout accepts only a pass product id", () => {
    expect(
      basePassCheckoutSchema.safeParse({ passProductId: "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d" }).success
    ).toBe(true);
  });

  it("base-pass checkout rejects smuggled amount fields", () => {
    const parsed = basePassCheckoutSchema.safeParse({
      passProductId: "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d",
      amountPaise: 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("event checkout rejects smuggled price/quantity fields", () => {
    const parsed = eventCheckoutSchema.safeParse({
      registrationMode: "INDIVIDUAL",
      priceRupees: 1,
      quantity: 5,
    });
    expect(parsed.success).toBe(false);
  });

  it("event checkout requires teamDraftId for TEAM mode", () => {
    expect(
      eventCheckoutSchema.safeParse({ registrationMode: "TEAM" }).success
    ).toBe(false);
    expect(
      eventCheckoutSchema.safeParse({
        registrationMode: "TEAM",
        teamDraftId: "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d",
      }).success
    ).toBe(true);
  });

  it("razorpay verify payload is bounded", () => {
    expect(
      razorpayVerifySchema.safeParse({
        razorpayOrderId: "order_1",
        razorpayPaymentId: "pay_1",
        razorpaySignature: "sig",
      }).success
    ).toBe(true);
    expect(
      razorpayVerifySchema.safeParse({
        razorpayOrderId: "x".repeat(500),
        razorpayPaymentId: "pay_1",
        razorpaySignature: "sig",
      }).success
    ).toBe(false);
  });

  it("idempotency keys must be UUIDs", () => {
    expect(idempotencyKeySchema.safeParse("not-a-uuid").success).toBe(false);
    expect(
      idempotencyKeySchema.safeParse("6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d").success
    ).toBe(true);
  });
});

describe("admin price schema", () => {
  it("requires a reason and a sane price range", () => {
    expect(
      eventPriceSchema.safeParse({ priceRupees: 200, reason: "early bird ended", version: 3 }).success
    ).toBe(true);
    expect(
      eventPriceSchema.safeParse({ priceRupees: 200, reason: "no", version: 3 }).success
    ).toBe(false); // reason too short
    expect(
      eventPriceSchema.safeParse({ priceRupees: -5, reason: "valid reason", version: 3 }).success
    ).toBe(false);
    expect(
      eventPriceSchema.safeParse({ priceRupees: 2_000_000, reason: "valid reason", version: 3 }).success
    ).toBe(false); // above 1,000,000 cap
  });
});

describe("admin event schema invariants", () => {
  const base = {
    name: "Battle of Bands",
    slug: "battle-of-bands",
    categoryId: "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d",
    venueId: null,
    shortDescription: "A short description of the event",
    description: "A longer description of the event rules",
    rulesMarkdown: null,
    startsAt: "2027-02-20T09:00:00.000Z",
    endsAt: "2027-02-20T18:00:00.000Z",
    isNightEvent: false,
    includeInSchedule: true,
    registrationMode: "INDIVIDUAL",
    capacityBasis: "PARTICIPANT",
    priceBasis: "REGISTRATION",
    minTeamSize: 1,
    maxTeamSize: 1,
    capacityUnits: 100,
    priceRupees: 200,
    prizePoolText: "₹50,000",
    registrationOpensAt: null,
    registrationClosesAt: null,
    featured: false,
    version: 1,
  };

  it("accepts a valid individual event", () => {
    expect(eventAdminSchema.safeParse(base).success).toBe(true);
  });

  it("validates and transforms imageUrl correctly", () => {
    const withUrl = eventAdminSchema.safeParse({
      ...base,
      imageUrl: "https://example.com/poster.jpg",
    });
    expect(withUrl.success).toBe(true);
    if (withUrl.success) {
      expect(withUrl.data.imageUrl).toBe("https://example.com/poster.jpg");
    }

    const withEmpty = eventAdminSchema.safeParse({
      ...base,
      imageUrl: "   ",
    });
    expect(withEmpty.success).toBe(true);
    if (withEmpty.success) {
      expect(withEmpty.data.imageUrl).toBeNull();
    }

    const withInvalidUrl = eventAdminSchema.safeParse({
      ...base,
      imageUrl: "ftp://not-supported",
    });
    expect(withInvalidUrl.success).toBe(false);
  });

  it("rejects individual events with team size != 1", () => {
    expect(
      eventAdminSchema.safeParse({ ...base, maxTeamSize: 4 }).success
    ).toBe(false);
  });

  it("rejects inverted time ranges", () => {
    expect(
      eventAdminSchema.safeParse({ ...base, startsAt: base.endsAt, endsAt: base.startsAt }).success
    ).toBe(false);
  });

  it("rejects min > max team size", () => {
    expect(
      eventAdminSchema.safeParse({
        ...base,
        registrationMode: "TEAM",
        minTeamSize: 5,
        maxTeamSize: 2,
      }).success
    ).toBe(false);
  });
});

describe("public form schemas", () => {
  it("support questions reject control characters", () => {
    expect(
      supportQuestionSchema.safeParse({
        name: "Aarav",
        email: "a@b.com",
        topic: "Passes",
        question: "How do I get my pass after paying?",
      }).success
    ).toBe(true);
    expect(
      supportQuestionSchema.safeParse({
        name: "Aarav",
        email: "a@b.com",
        topic: "Passes",
        question: "bad\u0000input",
      }).success
    ).toBe(false);
  });

  it("verify codes are normalized to uppercase alphanumerics", () => {
    expect(verifyQuerySchema.safeParse({ code: "pp-abc123def456" }).success).toBe(true);
    expect(verifyQuerySchema.safeParse({ code: "drop table;" }).success).toBe(false);
  });
});

describe("admin sponsor schema", () => {
  it("accepts a valid sponsor with logo and hyperlink", () => {
    const valid = {
      name: "Apex Healthcare",
      category: "Title Sponsor",
      tagline: "Leading surgical and hospital systems",
      logoUrl: "/uploads/sponsors/apex.png",
      websiteUrl: "https://apex.example.com",
      colorKey: "accent",
      sortOrder: 1,
      isTitle: true,
      isActive: true,
      version: 1,
    };
    expect(sponsorAdminSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts sponsor without website hyperlink", () => {
    const valid = {
      name: "RedBull",
      category: "Beverage Partner",
      tagline: "Official beverage partner",
      logoUrl: "https://images.unsplash.com/redbull.png",
      websiteUrl: "",
      colorKey: "secondary",
      sortOrder: 2,
      isTitle: false,
      isActive: true,
      version: 0,
    };
    expect(sponsorAdminSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects sponsor with missing logoUrl", () => {
    const invalid = {
      name: "Brand",
      category: "Partner",
      tagline: "",
      logoUrl: "",
      colorKey: "white",
    };
    expect(sponsorAdminSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("merchandise schemas", () => {
  it("accepts a valid merchandise product with 5 images", () => {
    const valid = {
      name: "TARANG ’27 Heavyweight Hoodie",
      slug: "tarang-27-heavyweight-hoodie",
      tagline: "Official Festival Apparel",
      description: "Heavyweight 380 GSM fleece hoodie with custom puff-print typography.",
      detailsMarkdown: "100% French Terry Cotton · Preshrunk · Unisex Relaxed Fit",
      category: "Apparel",
      priceRupees: 1499,
      images: [
        "https://example.com/img1.jpg",
        "https://example.com/img2.jpg",
        "https://example.com/img3.jpg",
        "https://example.com/img4.jpg",
        "https://example.com/img5.jpg",
      ],
      sizes: ["S", "M", "L", "XL", "XXL"],
      stockUnits: 150,
      salesState: "OPEN",
      status: "PUBLISHED",
      featured: true,
      sortOrder: 1,
      version: 1,
    };
    expect(merchandiseAdminSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects merchandise product with empty images array", () => {
    const invalid = {
      name: "T-Shirt",
      slug: "t-shirt",
      description: "Cool festival tee.",
      priceRupees: 499,
      images: [],
      stockUnits: 50,
    };
    expect(merchandiseAdminSchema.safeParse(invalid).success).toBe(false);
  });

  it("accepts valid merchandise checkout payload for campus pickup", () => {
    const valid = {
      productId: "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d",
      selectedSize: "L",
      quantity: 2,
      recipientName: "Aarav Sharma",
      recipientPhone: "+919876543210",
      recipientEmail: "aarav@example.com",
      deliveryMode: "PICKUP",
      shippingAddress: null,
    };
    expect(merchandiseCheckoutSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects checkout with invalid email or negative quantity", () => {
    const invalid = {
      productId: "6f9b9a1c-1234-4a5b-8c9d-0e1f2a3b4c5d",
      selectedSize: "M",
      quantity: -1,
      recipientName: "Aarav",
      recipientPhone: "+919876543210",
      recipientEmail: "not-an-email",
    };
    expect(merchandiseCheckoutSchema.safeParse(invalid).success).toBe(false);
  });
});
