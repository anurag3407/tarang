import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { supabaseConfigured } from "@/lib/env";
import { toPaise } from "@/lib/money";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { getClientIp } from "@/lib/request-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/pass-products — published pass products with current price
 * (checkout UI needs the product id; the amount is display-only, the server
 * always recalculates at checkout).
 *
 * When Supabase is not configured we serve the bundled base delegate pass for
 * display (plan §16: keep public static content on outage). Actual checkout
 * still fails closed because writes require the database.
 */
export async function GET(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    await enforceRateLimit("public", `pass-products:${ip}`, { failClosed: false });

    if (!supabaseConfigured()) {
      return apiSuccess(req, { source: "static", products: staticPassProducts() });
    }

    const sb = createServiceRoleClient();
    const { data, error } = await sb
      .from("pass_products")
      .select(
        `id, slug, name, description, is_base_pass, requires_base_pass, sales_state, valid_from,
         valid_until, current_price_version_id`
      )
      .eq("status", "PUBLISHED")
      .order("created_at", { ascending: true })
      .limit(10);
    if (error) return apiError(req, "INTERNAL", "Could not load pass products");

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

    const products = (data ?? []).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      description: p.description,
      isBasePass: p.is_base_pass,
      requiresBasePass: p.requires_base_pass,
      amountPaise: prices.get(p.current_price_version_id) ?? 0,
      currency: "INR",
      salesState: p.sales_state,
      validFrom: p.valid_from,
      validUntil: p.valid_until,
    }));
    return apiSuccess(req, { source: "db", products });
  } catch (err) {
    return apiFromError(req, err);
  }
}

/** Static pass products matching seed.sql (₹200 basic + ₹2000 delegate). */
function staticPassProducts() {
  return [
    {
      id: "static-base-delegate-pass",
      slug: "base-delegate-pass",
      name: "Basic Card",
      description:
        "Standard 5-day festival entry card. Required before registering for events.",
      isBasePass: true,
      requiresBasePass: false,
      amountPaise: 20000,
      currency: "INR",
      salesState: "OPEN",
      validFrom: "2026-09-01T00:00:00+00:00",
      validUntil: "2026-09-22T00:00:00+00:00",
    },
    {
      id: "static-vip-delegate-pass",
      slug: "vip-delegate-pass",
      name: "All-Access Delegate Card",
      description:
        "All-access 5-day card with entry to all pro-show concerts, VIP front-row seating, fast-track entry, and artist lounge access.",
      isBasePass: false,
      requiresBasePass: true,
      amountPaise: 200000,
      currency: "INR",
      salesState: "OPEN",
      validFrom: "2026-09-01T00:00:00+00:00",
      validUntil: "2026-09-22T00:00:00+00:00",
    },
  ];
}
