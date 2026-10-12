import type { NextRequest } from "next/server";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { requireUser } from "@/services/authz";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildQrToken, issueQrCredential } from "@/services/qr-service";

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
    const { passId } = await ctx.params;
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

    const prod = Array.isArray(pass.pass_products) ? pass.pass_products[0] : pass.pass_products;
    const isVipDelegatePass =
      prod?.slug === "vip-delegate-pass" ||
      (!prod?.is_base_pass && prod !== null) ||
      prod?.name?.toLowerCase().includes("delegate") ||
      prod?.name?.toLowerCase().includes("all-access") ||
      prod?.name?.toLowerCase().includes("vip");

    if (!isVipDelegatePass) {
      return apiError(
        req,
        "FORBIDDEN",
        "QR codes are issued exclusively for the VIP All-Access Delegate Pass. Basic Cards use the unique verification string code in the dashboard for gate entry."
      );
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
