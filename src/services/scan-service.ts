import "server-only";
import { createHash } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { verifyQrToken, tokenDigest } from "@/lib/qr/credential";
import { env } from "@/lib/env";
import type { ScanResult } from "@/domain/scanning";

/**
 * Scan service (plan §9.10, §14.6).
 *
 * The device submits a raw QR token. We verify the Ed25519 signature and
 * time window, then hand the credential jti to the atomic record_scan
 * function. The same scanId retried returns the prior result (idempotent).
 * Only limited display context is returned — never broad participant data.
 */

export interface ScanInput {
  scanId: string;
  rawToken: string;
  gateId: string;
  deviceId: string;
  operatorUserId: string;
  capturedAtDevice: string;
  offlineFlag: boolean;
  override?: boolean;
  overrideReason?: string;
}

function maskName(name: string | null): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (trimmed.length <= 2) return `${trimmed[0]}*`;
  return `${trimmed[0]}${"*".repeat(Math.min(trimmed.length - 2, 6))}${trimmed[trimmed.length - 1]}`;
}

export async function performScan(input: ScanInput): Promise<ScanResult> {
  const sb = createServiceRoleClient();

  // 1. Verify the signed token (signature + nbf/exp against server time).
  const verified = await verifyQrToken(input.rawToken);
  const digest = tokenDigest(input.rawToken);

  if (!verified.valid || !verified.payload) {
    // Still record the attempt for audit, then return the failure outcome.
    const outcome =
      verified.reason === "expired"
        ? "expired"
        : verified.reason === "not_yet_valid"
          ? "not_yet_valid"
          : verified.reason === "unknown_key"
            ? "invalid_signature"
            : "invalid_signature";

    const { data, error } = await sb.rpc("record_scan", {
      p_scan_id: input.scanId,
      p_credential_jti: null,
      p_gate_id: input.gateId,
      p_device_id: input.deviceId,
      p_operator_user_id: input.operatorUserId,
      p_captured_at_device: input.capturedAtDevice,
      p_offline_provisional: input.offlineFlag,
      p_credential_state: outcome,
      p_credential_digest: digest,
      p_pass_class: null,
      p_masked_name: null,
      p_override: input.override ?? false,
      p_override_reason: input.overrideReason ?? null,
    });
    if (error) {
      // An audit write that fails must not mask the verification outcome,
      // but it has to be loud: lost audit rows hide scanning abuse.
      logger().error(
        { scanId: input.scanId, err: error.message ?? String(error) },
        "record_scan audit write failed for invalid token"
      );
    }
    return normalizeScanResult(data, outcome);
  }

  const payload = verified.payload;

  // 2. Resolve the credential + pass owner for masked display context.
  const { data: credential } = await sb
    .from("qr_credentials")
    .select(
      `jti, state, delegate_pass_id,
       delegate_passes ( user_id, state, profiles ( display_name ) )`
    )
    .eq("jti", payload.jti)
    .maybeSingle();

  let maskedName: string | null = null;
  let credentialState = "valid";
  if (credential) {
    const pass = Array.isArray(credential.delegate_passes)
      ? credential.delegate_passes[0]
      : credential.delegate_passes;
    if (pass?.state === "REFUNDED") {
      credentialState = "refunded";
    }
    const profile = pass
      ? Array.isArray(pass.profiles)
        ? pass.profiles[0]
        : pass.profiles
      : null;
    maskedName = maskName(profile?.display_name ?? null);
  }

  // 3. Atomic scan + admission decision.
  const { data, error } = await sb.rpc("record_scan", {
    p_scan_id: input.scanId,
    p_credential_jti: payload.jti,
    p_gate_id: input.gateId,
    p_device_id: input.deviceId,
    p_operator_user_id: input.operatorUserId,
    p_captured_at_device: input.capturedAtDevice,
    p_offline_provisional: input.offlineFlag,
    p_credential_state: credentialState,
    p_credential_digest: digest,
    p_pass_class: payload.class,
    p_masked_name: maskedName,
    p_override: input.override ?? false,
    p_override_reason: input.overrideReason ?? null,
  });
  if (error) {
    throw new AppError("INTERNAL", "Scan could not be recorded");
  }

  return normalizeScanResult(data, null);
}

function normalizeScanResult(
  data: unknown,
  fallbackOutcome: string | null
): ScanResult {
  const raw = (data ?? {}) as {
    outcome?: string;
    reason?: string | null;
    display?: { maskedName?: string | null; passClass?: string | null } | null;
    recentScans?: { gateName?: string; at?: string; outcome?: string }[];
  };
  return {
    outcome: (raw.outcome ?? fallbackOutcome ?? "invalid_signature") as ScanResult["outcome"],
    reasonCode: raw.reason ?? null,
    display: raw.display
      ? {
          maskedName: raw.display.maskedName ?? null,
          passClass: raw.display.passClass ?? null,
          eventName: null,
        }
      : null,
    recentScans: (raw.recentScans ?? []).map((s) => ({
      gateName: s.gateName ?? "",
      at: s.at ?? "",
      outcome: s.outcome ?? "",
    })),
  };
}

/** Hash a device credential for storage/lookup (never store raw). */
export function deviceCredentialHash(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}

export const DEFAULT_SCANNER_CREDENTIAL = "pulse-web-scanner-default-credential";

/** True when the shared default scanner credential is enabled (dev only). */
export function defaultScannerCredentialEnabled(): boolean {
  return env().SCANNER_ALLOW_DEFAULT_CREDENTIAL;
}

/**
 * Ensure default web scanner device exists for seamless browser scanner access.
 */
export async function ensureDefaultScannerDevice(
  sb: ReturnType<typeof createServiceRoleClient>
): Promise<{ id: string; public_device_id: string; name: string; state: string }> {
  const hash = deviceCredentialHash(DEFAULT_SCANNER_CREDENTIAL);
  const { data: existing } = await sb
    .from("scanner_devices")
    .select("id, public_device_id, name, state")
    .eq("credential_hash", hash)
    .maybeSingle();

  if (existing) {
    if (existing.state !== "ACTIVE") {
      await sb.from("scanner_devices").update({ state: "ACTIVE" }).eq("id", existing.id);
      existing.state = "ACTIVE";
    }
    return existing;
  }

  const { data: created } = await sb
    .from("scanner_devices")
    .insert({
      name: "Web Scanner",
      credential_hash: hash,
      state: "ACTIVE",
    })
    .select("id, public_device_id, name, state")
    .maybeSingle();

  return (
    created ?? {
      id: "00000000-0000-0000-0000-000000000001",
      public_device_id: "SD-WEB",
      name: "Web Scanner",
      state: "ACTIVE",
    }
  );
}

/**
 * Dev-only bootstrap: ensure an active gate assignment exists for a device,
 * operator, and gate.
 *
 * Runs only while SCANNER_ALLOW_DEFAULT_CREDENTIAL is enabled and the shared
 * default credential is presented; real enrolled devices get assignments
 * through the admin panel. There is deliberately NO fallback to "first
 * active gate": silently assigning another gate corrupts admission scope and
 * audit. If the requested gate does not exist or is inactive, "" is returned
 * and record_scan rejects the scan (unknown_gate / gate_inactive).
 */
export async function ensureGateAssignment(
  sb: ReturnType<typeof createServiceRoleClient>,
  deviceId: string,
  operatorUserId: string,
  gateId: string
): Promise<string> {
  if (!gateId) return "";
  const { data: gate } = await sb
    .from("gates")
    .select("id")
    .eq("id", gateId)
    .eq("is_active", true)
    .maybeSingle();
  if (!gate) return "";

  const { data: existing } = await sb
    .from("gate_assignments")
    .select("id")
    .eq("device_id", deviceId)
    .eq("operator_user_id", operatorUserId)
    .eq("gate_id", gate.id)
    .gte("valid_until", new Date().toISOString())
    .maybeSingle();

  if (!existing) {
    const validUntil = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    await sb.from("gate_assignments").insert({
      device_id: deviceId,
      operator_user_id: operatorUserId,
      gate_id: gate.id,
      valid_from: new Date().toISOString(),
      valid_until: validUntil,
    });
  }

  return gate.id;
}
