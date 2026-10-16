import type { NextRequest } from "next/server";
import { AppError, apiError, apiFromError, apiSuccess } from "@/lib/api";
import { logger } from "@/lib/logger";
import { validateMutationRequest } from "@/lib/csrf";
import { supabaseConfigured } from "@/lib/env";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp, hashIdentifier } from "@/lib/request-context";
import { readJsonBody } from "@/lib/route-utils";
import { verifyQuerySchema } from "@/lib/validation/schemas";
import { verifyTurnstile } from "@/lib/turnstile";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isPronitePassProduct } from "@/lib/pronite-pass";

export const dynamic = "force-dynamic";

/**
 * Loose row shape for the nested PostgREST selects below: to-one relations
 * are returned as an object and to-many as a 1-row array depending on the
 * FK shape, so relations are typed as the union and unwrapped by firstRow().
 */
interface VerifyRow {
  id?: string;
  public_pass_code?: string;
  public_registration_code?: string;
  public_order_code?: string;
  state?: string;
  checkout_state?: string;
  kind?: string;
  activated_at?: string | null;
  created_at?: string | null;
  confirmed_at?: string | null;
  fulfilled_at?: string | null;
  expires_at?: string | null;
  user_id?: string | null;
  owner_user_id?: string | null;
  purchaser_user_id?: string | null;
  team_name?: string | null;
  display_name?: string | null;
  college_name?: string | null;
  is_base_pass?: boolean | null;
  slug?: string | null;
  name?: string | null;
  description?: string | null;
  year?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  line_kind?: string | null;
  description_snapshot?: string | null;
  pass_products?: VerifyRow | VerifyRow[] | null;
  festivals?: VerifyRow | VerifyRow[] | null;
  events?: VerifyRow | VerifyRow[] | null;
  order_lines?: VerifyRow | VerifyRow[] | null;
}

/** Unwrap a to-one-or-many PostgREST relation to a single row. */
function firstRow(v: VerifyRow | VerifyRow[] | null | undefined): VerifyRow | undefined {
  return Array.isArray(v) ? (v[0] ?? undefined) : (v ?? undefined);
}

/**
 * POST /api/public/verify — pass and registration verification endpoint.
 *
 * Verifies authenticity (Real vs Fake), purchase timestamp, pass type,
 * validity status, and masked attendee details across Delegate Passes,
 * Basic Cards, Event Registrations, and Orders.
 */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const body = await readJsonBody<Record<string, unknown>>(req, 4 * 1024);
    const parsed = verifyQuerySchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid pass code format");
    }
    const rawCode = parsed.data.code;
    const cleanCode = rawCode.replace(/\s+/g, "").toUpperCase();

    const ip = getClientIp(req);
    if (ip) {
      await enforceRateLimit("verifyIp", `ip:${hashIdentifier(ip)}`, {
        failClosed: false,
      });
    }
    await enforceRateLimit("verify", `code:${hashIdentifier(cleanCode)}`, {
      failClosed: false,
    });

    // Always verify. Outside production with no secret configured,
    // verifyTurnstile is a no-op; a configured secret (any env) requires a
    // valid token, and production without a secret fails closed (V-08).
    const turnstileToken =
      typeof body.turnstileToken === "string" ? body.turnstileToken : undefined;
    const turnstileOk = await verifyTurnstile(turnstileToken, ip);
    if (!turnstileOk) {
      return apiError(req, "FORBIDDEN", "Bot check failed. Please try again.");
    }

    if (!supabaseConfigured()) {
      return apiError(
        req,
        "MAINTENANCE",
        "Verification is temporarily unavailable. Please try again later."
      );
    }

    const sb = createServiceRoleClient();
    const isUuid = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(cleanCode);

    // -------------------------------------------------------------------------
    // 1. Check delegate_passes (VIP Delegate Passes & Basic Festival Cards)
    // -------------------------------------------------------------------------
    const possiblePassCodes = [
      cleanCode,
      cleanCode.startsWith("PP-") ? cleanCode : `PP-${cleanCode}`,
      cleanCode.startsWith("PASS-") ? `PP-${cleanCode.replace(/^PASS-/, "")}` : cleanCode,
      cleanCode.replace(/^PP-/, ""),
    ];

    let passRecord: VerifyRow | null = null;
    const { data: passes, error: passesErr } = await sb
      .from("delegate_passes")
      .select(`
        id,
        public_pass_code,
        state,
        activated_at,
        created_at,
        expires_at,
        user_id,
        pass_product_id,
        festival_id,
        pass_products (
          id,
          name,
          slug,
          is_base_pass,
          description
        ),
        festivals (
          id,
          name,
          year
        )
      `)
      .in("public_pass_code", possiblePassCodes)
      .order("created_at", { ascending: false })
      .limit(1);
    assertLookup(passesErr);

    if (passes && passes.length > 0) {
      passRecord = passes[0];
    } else if (isUuid) {
      const { data: passById, error: passByIdErr } = await sb
        .from("delegate_passes")
        .select(`
          id,
          public_pass_code,
          state,
          activated_at,
          created_at,
          expires_at,
          user_id,
          pass_product_id,
          festival_id,
          pass_products (
            id,
            name,
            slug,
            is_base_pass,
            description
          ),
          festivals (
            id,
            name,
            year
          )
        `)
        .eq("id", cleanCode)
        .maybeSingle();
      assertLookup(passByIdErr);

      if (passById) passRecord = passById;
    }

    if (passRecord) {
      const prod = firstRow(passRecord.pass_products);
      const fest = firstRow(passRecord.festivals);

      let profileRecord: VerifyRow | null = null;
      if (passRecord.user_id) {
        const { data: prof, error: profErr } = await sb
          .from("profiles")
          .select("display_name, college_name")
          .eq("user_id", passRecord.user_id)
          .maybeSingle();
        assertLookup(profErr);
        profileRecord = prof;
      }

      const now = new Date();
      const isExpired = passRecord.expires_at ? new Date(passRecord.expires_at) < now : false;
      const isRevoked = passRecord.state === "REVOKED";
      const isRefunded = passRecord.state === "REFUNDED";
      const isActive = passRecord.state === "ACTIVE" && !isExpired;

      let status: "ACTIVE" | "EXPIRED" | "REVOKED" | "REFUNDED" = "ACTIVE";
      if (isRefunded) status = "REFUNDED";
      else if (isRevoked) status = "REVOKED";
      else if (isExpired) status = "EXPIRED";

      const isBasePass = Boolean(prod?.is_base_pass);
      const isDelegate = prod == null || isPronitePassProduct(prod);

      const passTypeLabel = isDelegate
        ? "Pronite Pass"
        : isBasePass
        ? "Basic Card (retired)"
        : prod?.name || "Festival Pass";

      const accessSummary = isDelegate
        ? "All 5 Star Night Concerts + 5-Day Campus Entry + Competition Access"
        : "5-Day General Campus Access + Competition Eligibility Cleared";

      const purchasedAt = passRecord.activated_at || passRecord.created_at;

      return apiSuccess(req, {
        isReal: true,
        valid: isActive,
        status,
        statusLabel: isActive
          ? "AUTHENTIC & VALID"
          : isRefunded
          ? "CANCELLED & REFUNDED"
          : isExpired
          ? "AUTHENTIC (EXPIRED)"
          : "AUTHENTIC (REVOKED)",
        passCode: passRecord.public_pass_code,
        passType: isDelegate ? "DELEGATE" : "BASIC",
        productName: prod?.name || passTypeLabel,
        description: prod?.description || accessSummary,
        accessSummary,
        purchasedAt: purchasedAt ? new Date(purchasedAt).toISOString() : null,
        expiresAt: passRecord.expires_at ? new Date(passRecord.expires_at).toISOString() : null,
        maskedName: maskName(profileRecord?.display_name ?? null),
        maskedCollege: maskCollege(profileRecord?.college_name ?? null),
        festivalName: fest?.name ? `${fest.name} ${fest.year || ""}`.trim() : "TARANG 2026",
        venue: "NIT Patna",
      });
    }

    // -------------------------------------------------------------------------
    // 2. Check registrations (Event Registrations)
    // -------------------------------------------------------------------------
    const possibleRegCodes = [
      cleanCode,
      cleanCode.startsWith("PR-") ? cleanCode : `PR-${cleanCode}`,
      cleanCode.replace(/^PR-/, ""),
    ];

    let regRecord: VerifyRow | null = null;
    const { data: regs, error: regsErr } = await sb
      .from("registrations")
      .select(`
        id,
        public_registration_code,
        state,
        confirmed_at,
        created_at,
        owner_user_id,
        team_name,
        events (
          id,
          name,
          starts_at,
          ends_at
        )
      `)
      .in("public_registration_code", possibleRegCodes)
      .order("created_at", { ascending: false })
      .limit(1);
    assertLookup(regsErr);

    if (regs && regs.length > 0) {
      regRecord = regs[0];
    } else if (isUuid) {
      const { data: regById, error: regByIdErr } = await sb
        .from("registrations")
        .select(`
          id,
          public_registration_code,
          state,
          confirmed_at,
          created_at,
          owner_user_id,
          team_name,
          events (
            id,
            name,
            starts_at,
            ends_at
          )
        `)
        .eq("id", cleanCode)
        .maybeSingle();
      assertLookup(regByIdErr);

      if (regById) regRecord = regById;
    }

    if (regRecord) {
      const ev = firstRow(regRecord.events);
      let profileRecord: VerifyRow | null = null;
      if (regRecord.owner_user_id) {
        const { data: prof, error: profErr } = await sb
          .from("profiles")
          .select("display_name, college_name")
          .eq("user_id", regRecord.owner_user_id)
          .maybeSingle();
        assertLookup(profErr);
        profileRecord = prof;
      }

      const isConfirmed = regRecord.state === "CONFIRMED";
      const purchasedAt = regRecord.confirmed_at || regRecord.created_at;

      return apiSuccess(req, {
        isReal: true,
        valid: isConfirmed,
        status: isConfirmed ? "ACTIVE" : "REVOKED",
        statusLabel: isConfirmed ? "AUTHENTIC REGISTRATION" : "CANCELLED REGISTRATION",
        passCode: regRecord.public_registration_code,
        passType: "EVENT_REGISTRATION",
        productName: ev?.name || "Event Registration",
        description: `Official registration for ${ev?.name || "Competition"}`,
        accessSummary: `Confirmed participation in ${ev?.name || "Event"}${regRecord.team_name ? ` (Team: ${regRecord.team_name})` : ""}`,
        purchasedAt: purchasedAt ? new Date(purchasedAt).toISOString() : null,
        expiresAt: ev?.ends_at ? new Date(ev.ends_at).toISOString() : null,
        maskedName: maskName(profileRecord?.display_name ?? null),
        maskedCollege: maskCollege(profileRecord?.college_name ?? null),
        teamName: regRecord.team_name ?? null,
        festivalName: "TARANG 2026",
        venue: "NIT Patna",
      });
    }

    // -------------------------------------------------------------------------
    // 3. Check orders (Order codes ORD-...)
    // -------------------------------------------------------------------------
    const possibleOrderCodes = [
      cleanCode,
      cleanCode.startsWith("ORD-") ? cleanCode : `ORD-${cleanCode}`,
      cleanCode.replace(/^ORD-/, ""),
    ];

    let orderRecord: VerifyRow | null = null;
    const { data: orders, error: ordersErr } = await sb
      .from("orders")
      .select(`
        id,
        public_order_code,
        kind,
        checkout_state,
        fulfilled_at,
        created_at,
        purchaser_user_id,
        order_lines (
          line_kind,
          description_snapshot,
          pass_products ( name, slug, is_base_pass ),
          events ( name )
        )
      `)
      .in("public_order_code", possibleOrderCodes)
      .order("created_at", { ascending: false })
      .limit(1);
    assertLookup(ordersErr);

    if (orders && orders.length > 0) {
      orderRecord = orders[0];
    } else if (isUuid) {
      const { data: orderById, error: orderByIdErr } = await sb
        .from("orders")
        .select(`
          id,
          public_order_code,
          kind,
          checkout_state,
          fulfilled_at,
          created_at,
          purchaser_user_id,
          order_lines (
            line_kind,
            description_snapshot,
            pass_products ( name, slug, is_base_pass ),
            events ( name )
          )
        `)
        .eq("id", cleanCode)
        .maybeSingle();
      assertLookup(orderByIdErr);

      if (orderById) orderRecord = orderById;
    }

    if (orderRecord) {
      let profileRecord: VerifyRow | null = null;
      if (orderRecord.purchaser_user_id) {
        const { data: prof, error: profErr } = await sb
          .from("profiles")
          .select("display_name, college_name")
          .eq("user_id", orderRecord.purchaser_user_id)
          .maybeSingle();
        assertLookup(profErr);
        profileRecord = prof;
      }

      const line = firstRow(orderRecord.order_lines);
      const isFulfilled = orderRecord.checkout_state === "FULFILLED";
      const purchasedAt = orderRecord.fulfilled_at || orderRecord.created_at;

      return apiSuccess(req, {
        isReal: true,
        valid: isFulfilled,
        status: isFulfilled ? "ACTIVE" : "REVOKED",
        statusLabel: isFulfilled ? "AUTHENTIC ORDER" : "ORDER (NOT YET CONFIRMED)",
        passCode: orderRecord.public_order_code,
        passType: orderRecord.kind === "BASE_PASS" ? "PASS_ORDER" : "EVENT_ORDER",
        productName:
          line?.description_snapshot ||
          firstRow(line?.pass_products)?.name ||
          firstRow(line?.events)?.name ||
          "Festival Order",
        description: "Official TARANG purchase order",
        accessSummary: isFulfilled
          ? "Order fulfilled and verified"
          : "Order placed but not yet confirmed",
        purchasedAt: purchasedAt ? new Date(purchasedAt).toISOString() : null,
        expiresAt: null,
        maskedName: maskName(profileRecord?.display_name ?? null),
        maskedCollege: maskCollege(profileRecord?.college_name ?? null),
        festivalName: "TARANG 2026",
        venue: "NIT Patna",
      });
    }

    // -------------------------------------------------------------------------
    // 4. Not found in any table -> FAKE / UNRECOGNIZED
    // -------------------------------------------------------------------------
    return apiSuccess(req, {
      isReal: false,
      valid: false,
      status: "FAKE_OR_UNRECOGNIZED",
      statusLabel: "FAKE / UNVERIFIED",
      passCode: cleanCode,
      message: `The pass code "${cleanCode}" was not found in the official TARANG 2026 database. This code is invalid or counterfeit.`,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/**
 * A failed lookup must never fall through to the "not found" verdict: that
 * would label a genuine pass as counterfeit whenever the database errors.
 */
function assertLookup(error: { message: string } | null): void {
  if (error) {
    logger().error({ err: error.message }, "verify lookup failed");
    throw new AppError(
      "UPSTREAM_ERROR",
      "Verification is temporarily unavailable. Please try again later."
    );
  }
}

function maskName(name: string | null): string | null {
  if (!name) return null;
  const words = name.trim().split(/\s+/);
  // First initial only — never reveal the last character, which combined
  // with the initial makes short names guessable.
  return words
    .map((w) => `${w[0]}${"*".repeat(Math.max(w.length - 1, 2))}`)
    .join(" ");
}

function maskCollege(college: string | null): string | null {
  if (!college) return null;
  const trimmed = college.trim();
  if (trimmed.length <= 6) {
    // Short names must not come back unmasked.
    return `${trimmed[0]}${"*".repeat(Math.max(trimmed.length - 1, 2))}`;
  }
  const start = trimmed.slice(0, 3);
  return `${start}${"*".repeat(Math.min(trimmed.length - 3, 8))}`;
}
