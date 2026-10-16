import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { requireUser } from "@/services/authz";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildQrToken, issueQrCredential } from "@/services/qr-service";
import { isPronitePassProduct } from "@/lib/pronite-pass";
import { requireUuid } from "@/lib/route-utils";

export const dynamic = "force-dynamic";

/**
 * GET /api/me/passes/:passId/qr — owner-authorized QR token (plan §14.2.4).
 *
 * Returns the signed token + metadata. The dashboard renders the QR image
 * client-side; a PNG variant is available via ?format=png. The raw token is
 * never logged or permanently stored.
 */
export async function GET(
  req: NextRequest,
  ctx: RouteContext<"/api/me/passes/[passId]/qr">
) {
  try {
    const passId = requireUuid((await ctx.params).passId, "Pass");
    const auth = await requireUser();
    await enforceRateLimit("me", `user:${auth.userId}`, { failClosed: false });

    const sb = createServiceRoleClient();
    const { data: pass } = await sb
      .from("delegate_passes")
      .select("id, user_id, state, public_pass_code, pass_products ( id, name, slug, is_base_pass )")
      .eq("id", passId)
      .maybeSingle();
    if (!pass) return apiError(req, "NOT_FOUND", "Pass not found");
    if (pass.user_id !== auth.userId) {
      return apiError(req, "FORBIDDEN", "This pass does not belong to your account");
    }
    if (pass.state !== "ACTIVE") {
      return apiError(req, "CONFLICT", "This pass is not active — QR is unavailable");
    }

    // Gate QR is issued for the Pronite Pass only — a retired basic pass has none.
    const prod = Array.isArray(pass.pass_products) ? pass.pass_products[0] : pass.pass_products;
    // A pass with no product row predates the catalog (e.g. bulk issuance) and
    // has always been treated as the delegate — now Pronite — pass.
    if (prod != null && !isPronitePassProduct(prod)) {
      return apiError(req, "FORBIDDEN", "Gate QR codes are issued for the Pronite Pass only.");
    }

    // Ensure a credential exists (normally created by the ISSUE_QR worker;
    // this is a safe idempotent fallback for the dashboard).
    await issueQrCredential(passId);
    const { token, expiresAt } = await buildQrToken(passId);

    if (req.nextUrl.searchParams.get("format") === "png") {
      const png = await QRCode.toBuffer(token, {
        type: "png",
        width: 512,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#000000", light: "#FFFFFF" },
      });
      return new NextResponse(new Uint8Array(png), {
        headers: {
          "content-type": "image/png",
          "cache-control": "no-store",
        },
      });
    }

    return apiSuccess(req, {
      token,
      passCode: pass.public_pass_code,
      expiresAt,
      warning:
        "Anyone with this QR can enter. Do not share screenshots or forward this code.",
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
