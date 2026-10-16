import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { signQrToken, payloadDigest } from "@/lib/qr/credential";
import type { QrPayload } from "@/domain/scanning";

/**
 * QR issuance service (plan §14.2).
 *
 * Fulfillment inserts the delegate pass and an ISSUE_QR outbox job in the
 * same transaction; this service creates the active credential if one does
 * not already exist for the pass, then signs the token. The raw token is
 * generated on demand and never permanently stored — only its digest.
 */

export async function issueQrCredential(
  delegatePassId: string
): Promise<{ credentialId: string; jti: string }> {
  const sb = createServiceRoleClient();

  // Idempotent: reuse an existing ACTIVE credential for this pass.
  const { data: existing } = await sb
    .from("qr_credentials")
    .select("id, jti")
    .eq("delegate_pass_id", delegatePassId)
    .eq("state", "ACTIVE")
    .maybeSingle();
  if (existing) {
    return { credentialId: existing.id, jti: existing.jti };
  }

  const { data: pass } = await sb
    .from("delegate_passes")
    .select("id, state, festival_id, expires_at, festivals ( slug, ends_at )")
    .eq("id", delegatePassId)
    .maybeSingle();
  if (!pass) throw new AppError("NOT_FOUND", "Pass not found");
  if (pass.state !== "ACTIVE") {
    throw new AppError("CONFLICT", "Pass is not active");
  }

  const fest = Array.isArray(pass.festivals) ? pass.festivals[0] : pass.festivals;
  const now = new Date();
  const notBefore = now.toISOString();
  // Credential validity: pass expiry, else festival end, else 30 days.
  const expiresAt =
    pass.expires_at ??
    fest?.ends_at ??
    new Date(now.getTime() + 30 * 86_400_000).toISOString();

  // Revoke any prior non-active credentials' replacement chain is handled
  // by reissue; here we simply insert a fresh ACTIVE credential.
  const { data: credential, error } = await sb
    .from("qr_credentials")
    .insert({
      festival_id: pass.festival_id,
      delegate_pass_id: delegatePassId,
      key_id: env().QR_SIGNING_KEY_ID,
      entitlement_version: 1,
      state: "ACTIVE",
      not_before: notBefore,
      expires_at: expiresAt,
      token_digest: "pending",
    })
    .select("id, jti, entitlement_version, not_before, expires_at")
    .single();
  if (error) {
    // Lost a race: the ISSUE_QR job, the confirmation email and the dashboard
    // can all issue concurrently, and one ACTIVE credential per pass is
    // enforced by a unique index. Use the winner's credential.
    if (error.code === "23505") {
      const { data: winner } = await sb
        .from("qr_credentials")
        .select("id, jti")
        .eq("delegate_pass_id", delegatePassId)
        .eq("state", "ACTIVE")
        .maybeSingle();
      if (winner) return { credentialId: winner.id, jti: winner.jti };
    }
    logger().error(
      { delegatePassId, err: error.message, code: error.code },
      "qr credential insert failed"
    );
    throw new AppError("INTERNAL", "Could not create QR credential");
  }

  return { credentialId: credential.id, jti: credential.jti };
}

/** Build + sign the QR token for an active credential. */
export async function buildQrToken(
  delegatePassId: string
): Promise<{ token: string; expiresAt: string }> {
  const sb = createServiceRoleClient();
  const { data: credential } = await sb
    .from("qr_credentials")
    .select(
      `id, jti, entitlement_version, not_before, expires_at, state, festival_id,
       delegate_passes ( public_pass_code, festivals ( slug ) )`
    )
    .eq("delegate_pass_id", delegatePassId)
    .eq("state", "ACTIVE")
    .maybeSingle();
  if (!credential) {
    throw new AppError("NOT_FOUND", "No active QR credential for this pass");
  }

  const pass = Array.isArray(credential.delegate_passes)
    ? credential.delegate_passes[0]
    : credential.delegate_passes;
  const fest = pass
    ? Array.isArray(pass.festivals)
      ? pass.festivals[0]
      : pass.festivals
    : null;

  const payload: QrPayload = {
    v: 1,
    jti: credential.jti,
    fest: fest?.slug ?? "tarang",
    pass: pass?.public_pass_code ?? "",
    entv: credential.entitlement_version,
    nbf: Math.floor(new Date(credential.not_before).getTime() / 1000),
    exp: Math.floor(new Date(credential.expires_at).getTime() / 1000),
    class: "BASE",
  };

  const token = await signQrToken(payload);

  // Persist the digest (never the raw token).
  await sb
    .from("qr_credentials")
    .update({ token_digest: payloadDigest(payload) })
    .eq("id", credential.id);

  return { token, expiresAt: credential.expires_at };
}

/** Reissue: revoke the old credential and issue a fresh one (plan §14.2.6). */
export async function reissueQrCredential(
  delegatePassId: string
): Promise<{ credentialId: string; jti: string }> {
  const sb = createServiceRoleClient();
  await sb
    .from("qr_credentials")
    .update({ state: "REPLACED", revoked_at: new Date().toISOString() })
    .eq("delegate_pass_id", delegatePassId)
    .eq("state", "ACTIVE");

  // Bump entitlement version via a fresh credential.
  const { data: prior } = await sb
    .from("qr_credentials")
    .select("entitlement_version")
    .eq("delegate_pass_id", delegatePassId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const issued = await issueQrCredential(delegatePassId);
  const nextVersion = (prior?.entitlement_version ?? 0) + 1;
  await sb
    .from("qr_credentials")
    .update({ entitlement_version: nextVersion })
    .eq("id", issued.credentialId);

  return issued;
}

/** Generate a PNG data URL of the signed QR token for email embedding. */
export async function generatePassQrDataUrl(
  delegatePassId: string
): Promise<{ dataUrl: string; token: string; expiresAt: string }> {
  const QRCode = (await import("qrcode")).default;
  await issueQrCredential(delegatePassId);
  const { token, expiresAt } = await buildQrToken(delegatePassId);
  const dataUrl = await QRCode.toDataURL(token, {
    errorCorrectionLevel: "M",
    width: 280,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });
  return { dataUrl, token, expiresAt };
}
