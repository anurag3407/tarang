import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { validateMutationRequest } from "@/lib/csrf";
import { enforceRateLimit } from "@/lib/redis/rate-limits";
import { readJsonBody } from "@/lib/route-utils";
import { scanRequestSchema } from "@/lib/validation/schemas";
import { requirePermission } from "@/services/authz";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  performScan,
  deviceCredentialHash,
  DEFAULT_SCANNER_CREDENTIAL,
  defaultScannerCredentialEnabled,
  ensureDefaultScannerDevice,
  ensureGateAssignment,
} from "@/services/scan-service";
import { AppError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * POST /api/scanner/scan (plan §14.5, §14.6).
 *
 * Dual authentication: the operator must hold `scanner.use`, AND the device
 * must present an enrolled, non-revoked credential (separate revocable
 * secret, hashed at rest). scanId is stable across retries so the server
 * returns the same result for the same physical scan.
 */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const ctx = await requirePermission("scanner.use");

    // Device credential (plan §14.5.2): separate revocable secret.
    const deviceCredential = req.headers.get("x-scanner-device-credential");
    if (!deviceCredential) {
      throw new AppError("UNAUTHORIZED", "Device credential required");
    }

    // Rate limit before the device lookup so unknown/revoked credentials
    // cannot be enumerated at full speed (plan §14.5.2).
    await enforceRateLimit("scanner", `device-hash:${deviceCredentialHash(deviceCredential)}`, {
      failClosed: true,
    });

    const sb = createServiceRoleClient();
    let device: { id: string; state: string } | null = null;

    if (
      defaultScannerCredentialEnabled() &&
      deviceCredential === DEFAULT_SCANNER_CREDENTIAL
    ) {
      device = await ensureDefaultScannerDevice(sb);
    } else {
      const { data: found } = await sb
        .from("scanner_devices")
        .select("id, state")
        .eq("credential_hash", deviceCredentialHash(deviceCredential))
        .maybeSingle();
      device = found;
    }

    if (!device || device.state !== "ACTIVE") {
      throw new AppError("UNAUTHORIZED", "Device is not enrolled or was revoked");
    }

    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = scanRequestSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      return apiError(req, "VALIDATION_FAILED", `Invalid scan request (${issue})`);
    }
    const input = parsed.data;

    // Supervisor override requires the supervise permission (plan §14.7).
    if (input.override) {
      await requirePermission("scanner.supervise");
    }

    let gateId = input.gateId;
    if (
      defaultScannerCredentialEnabled() &&
      deviceCredential === DEFAULT_SCANNER_CREDENTIAL
    ) {
      gateId = await ensureGateAssignment(sb, device.id, ctx.userId, input.gateId);
    }

    const result = await performScan({
      scanId: input.scanId,
      rawToken: input.rawToken,
      gateId,
      deviceId: device.id,
      operatorUserId: ctx.userId,
      capturedAtDevice: input.capturedAtDevice,
      offlineFlag: input.offlineFlag,
      override: input.override,
      overrideReason: input.overrideReason,
    });

    return apiSuccess(req, result);
  } catch (err) {
    return apiFromError(req, err);
  }
}
