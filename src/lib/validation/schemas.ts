import { z } from "zod";

/**
 * Zod validation schemas (plan §7.1.10, §11.9).
 *
 * All text accepted from admins/users has length constraints in both Zod and
 * SQL. Control characters are rejected on user-supplied free text.
 */

const noControlChars = z
  .string()
  .regex(/^[\P{C}]*$/u, "Control characters are not allowed");

export const supportQuestionSchema = z.object({
  name: noControlChars.trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  college: noControlChars.trim().max(160).optional().or(z.literal("")),
  topic: noControlChars.trim().min(2).max(80),
  question: noControlChars.trim().min(10).max(4000),
  turnstileToken: z.string().max(4096).optional(),
});

export const groupEntrySchema = z.object({
  leadName: noControlChars.trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\s\-()]{6,18}$/, "Enter a valid phone number"),
  college: noControlChars.trim().max(160).optional().or(z.literal("")),
  groupSize: z.coerce.number().int().min(1).max(500),
  notes: noControlChars.trim().max(4000).optional().or(z.literal("")),
  turnstileToken: z.string().max(4096).optional(),
});

/**
 * Pre-mutation gate for browser→Supabase auth calls (V-08). `purpose`
 * identifies the GoTrue call the client is about to make so the audit trail
 * and per-IP/per-email ceilings can be attributed; `email` is the target
 * account (when known) and `turnstileToken` an optional bot-check token.
 */
export const authGuardSchema = z
  .object({
    purpose: z.enum([
      "password_signin",
      "password_signup",
      "magic_link",
      "forgot_password",
      "reset_password",
      "resend_confirmation",
      "oauth_google",
    ]),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    turnstileToken: z.string().max(4096).optional(),
  })
  .strict();

export const idempotencyKeySchema = z
  .string()
  .uuid("Idempotency-Key must be a UUID");

/** Discount code: 4–32 letters, digits, "-" or "_"; case-insensitive (stored upper-case). */
export const discountCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{3,31}$/, "Discount codes are 4–32 letters, digits, - or _");

export const basePassCheckoutSchema = z
  .object({
    passProductId: z.string().uuid(),
    discountCode: discountCodeSchema.optional(),
  })
  .strict();

export const discountPreviewSchema = z
  .object({
    passProductId: z.string().uuid(),
    code: discountCodeSchema,
  })
  .strict();

export const eventCheckoutSchema = z
  .object({
    registrationMode: z.enum(["INDIVIDUAL", "TEAM"]),
    teamDraftId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (v) => v.registrationMode !== "TEAM" || Boolean(v.teamDraftId),
    { message: "teamDraftId is required for TEAM registration" }
  );

export const razorpayVerifySchema = z
  .object({
    razorpayOrderId: z.string().min(1).max(64),
    razorpayPaymentId: z.string().min(1).max(64),
    razorpaySignature: z.string().min(1).max(512),
  })
  .strict();

export const eventAdminSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    categoryId: z.string().uuid(),
    venueId: z.string().uuid().nullable(),
    shortDescription: z.string().trim().min(10).max(300),
    description: z.string().trim().min(10).max(4000),
    rulesMarkdown: z.string().trim().max(20000).nullable(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    isNightEvent: z.boolean(),
    includeInSchedule: z.boolean(),
    registrationMode: z.enum(["INDIVIDUAL", "TEAM"]),
    capacityBasis: z.enum(["TEAM", "PARTICIPANT"]),
    priceBasis: z.enum(["REGISTRATION", "PARTICIPANT"]),
    minTeamSize: z.number().int().min(1).max(100),
    maxTeamSize: z.number().int().min(1).max(100),
    capacityUnits: z.number().int().min(1).max(100000),
    priceRupees: z.number().min(0).max(1000000),
    prizePoolText: z.string().trim().max(120),
    registrationOpensAt: z.string().datetime().nullable(),
    registrationClosesAt: z.string().datetime().nullable(),
    featured: z.boolean(),
    imageUrl: z
      .string()
      .trim()
      .max(1000)
      .refine(
        (val) => !val || /^https?:\/\/.+/i.test(val) || val.startsWith("/"),
        { message: "Image URL must be a valid http(s) URL or relative path" }
      )
      .nullable()
      .optional()
      .transform((val) => (val && val.trim() !== "" ? val.trim() : null)),
    version: z.number().int().min(0),
  })
  .strict()
  .refine((v) => v.startsAt < v.endsAt, {
    message: "startsAt must be before endsAt",
  })
  .refine(
    (v) =>
      v.registrationMode !== "INDIVIDUAL" ||
      (v.minTeamSize === 1 && v.maxTeamSize === 1),
    { message: "Individual events must have team size 1" }
  )
  .refine((v) => v.minTeamSize <= v.maxTeamSize, {
    message: "minTeamSize must be <= maxTeamSize",
  });

export const eventPriceSchema = z
  .object({
    priceRupees: z.number().min(0).max(1000000),
    reason: z.string().trim().min(5).max(300),
    version: z.number().int().min(0),
  })
  .strict();

export const passPriceSchema = z
  .object({
    priceRupees: z.number().min(0).max(1000000),
    reason: z.string().trim().min(3).max(300),
    version: z.number().int().min(0).optional(),
  })
  .strict();

export const eventCapacitySchema = z
  .object({
    capacityUnits: z.number().int().min(0).max(100000),
    version: z.number().int().min(0),
  })
  .strict();

export const scheduleAdminSchema = z
  .object({
    linkedEventId: z.string().uuid().nullable(),
    title: z.string().trim().max(160).nullable(),
    venueId: z.string().uuid().nullable(),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    categoryKey: z.string().trim().min(2).max(40),
    isNight: z.boolean(),
    dayTheme: z.string().trim().max(120).nullable(),
    version: z.number().int().min(0),
  })
  .strict()
  .refine((v) => v.startsAt < v.endsAt, {
    message: "startsAt must be before endsAt",
  })
  .refine((v) => Boolean(v.linkedEventId) || Boolean(v.title), {
    message: "Standalone entries require a title",
  });

export const noticeAdminSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    tag: z.enum(["URGENT", "UPDATE", "INFO", "REGISTRATION"]),
    title: z.string().trim().min(5).max(160),
    bodyMarkdown: z.string().trim().min(5).max(8000),
    publishAt: z.string().datetime(),
    expiresAt: z.string().datetime().nullable(),
    pinned: z.boolean(),
    version: z.number().int().min(0),
  })
  .strict();

export const staffInviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    roleId: z.string().uuid(),
    eventIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict();

export const teamCreateSchema = z
  .object({
    eventId: z.string().uuid(),
    teamName: noControlChars.trim().min(3).max(60),
  })
  .strict();

export const teamJoinSchema = z
  .object({
    inviteCode: z.string().trim().min(16).max(64),
  })
  .strict();

export const scanRequestSchema = z
  .object({
    scanId: z.string().uuid(),
    rawToken: z.string().min(10).max(1024),
    gateId: z.string().uuid(),
    capturedAtDevice: z.string().datetime(),
    sequenceNumber: z.number().int().min(0),
    offlineFlag: z.boolean(),
    override: z.boolean().optional(),
    overrideReason: z.string().trim().min(5).max(300).optional(),
  })
  .strict()
  .refine((v) => !v.override || Boolean(v.overrideReason), {
    message: "overrideReason is required when override is true",
  });

export const verifyQuerySchema = z.object({
  code: z
    .string()
    .trim()
    .min(3)
    .max(100)
    .regex(/^[a-zA-Z0-9-_.@ ]{3,100}$/, "Invalid code format")
    .transform((val) => val.trim().toUpperCase()),
  turnstileToken: z.string().max(4096).optional(),
});

export const sponsorAdminSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    category: z.string().trim().min(1).max(100),
    tagline: z.string().trim().max(300).default(""),
    logoUrl: z.string().trim().min(1),
    websiteUrl: z
      .string()
      .trim()
      .refine((val) => val === "" || /^https?:\/\/.+/i.test(val), {
        message: "Website URL must be a valid http(s) URL",
      })
      .nullable()
      .optional()
      .default(""),
    colorKey: z.enum(["accent", "secondary", "muted", "white"]).default("secondary"),
    sortOrder: z.number().int().min(0).default(0),
    isTitle: z.boolean().default(false),
    isActive: z.boolean().default(true),
    version: z.number().int().min(0).default(0),
  })
  .strict();

export const merchandiseAdminSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    tagline: z.string().trim().max(300).optional().default(""),
    description: z.string().trim().min(5).max(2000),
    detailsMarkdown: z.string().trim().max(5000).nullable().optional().default(""),
    category: z.string().trim().min(1).max(100).default("Apparel"),
    priceRupees: z.number().min(0).max(1_000_000),
    images: z.array(z.string().trim().min(1)).min(1).max(10),
    sizes: z.array(z.string().trim().min(1).max(50)).min(1).max(30).default(["Standard"]),
    stockUnits: z.number().int().min(0).max(100_000),
    salesState: z
      .enum(["DRAFT", "SCHEDULED", "OPEN", "PAUSED", "SOLD_OUT", "CLOSED", "CANCELLED"])
      .default("OPEN"),
    status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).default("PUBLISHED"),
    featured: z.boolean().default(false),
    sortOrder: z.number().int().min(0).default(0),
    version: z.number().int().min(0).default(0),
  })
  .strict();

export const merchandiseCheckoutSchema = z
  .object({
    productId: z.string().uuid(),
    selectedSize: z.string().trim().min(1).max(50).default("Standard"),
    quantity: z.number().int().min(1).max(10).default(1),
    recipientName: z.string().trim().min(2).max(100),
    recipientPhone: z
      .string()
      .trim()
      .regex(/^\+?[0-9][0-9\s\-()]{6,18}$/, "Enter a valid phone number"),
    recipientEmail: z.string().trim().toLowerCase().email().max(254),
    deliveryMode: z.literal("PICKUP").default("PICKUP"),
    shippingAddress: z.null().optional().default(null),
  })
  .strict();


export const discountCodeCreateSchema = z
  .object({
    code: discountCodeSchema,
    description: z.string().trim().max(300).default(""),
    discountType: z.enum(["FLAT", "PERCENT"]),
    amountOffRupees: z.number().positive().max(1_000_000).multipleOf(0.01).nullable().default(null),
    percentOff: z.number().int().min(1).max(100).nullable().default(null),
    passProductId: z.string().uuid().nullable().default(null),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().default(null),
    perUserLimit: z.number().int().min(1).max(100).default(1),
    validFrom: z.string().datetime({ offset: true }).nullable().default(null),
    validUntil: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict()
  .refine(
    (v) =>
      v.discountType === "FLAT"
        ? v.amountOffRupees !== null && v.percentOff === null
        : v.percentOff !== null && v.amountOffRupees === null,
    { message: "Give an amount for a flat discount, or a percentage for a percent discount" }
  )
  .refine((v) => !v.validFrom || !v.validUntil || Date.parse(v.validUntil) > Date.parse(v.validFrom), {
    message: "Valid-until must be after valid-from",
  });

/**
 * Discount code edits. The code and its value are immutable once issued —
 * issue a new code instead — so orders and the audit trail stay unambiguous.
 */
export const discountCodeUpdateSchema = z
  .object({
    isActive: z.boolean().optional(),
    description: z.string().trim().max(300).optional(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
    perUserLimit: z.number().int().min(1).max(100).optional(),
    validFrom: z.string().datetime({ offset: true }).nullable().optional(),
    validUntil: z.string().datetime({ offset: true }).nullable().optional(),
    version: z.number().int().min(1),
  })
  .strict();
