import type { NextRequest } from "next/server";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { requirePermission } from "@/services/authz";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  deviceCredentialHash,
  DEFAULT_SCANNER_CREDENTIAL,
  defaultScannerCredentialEnabled,
  ensureDefaultScannerDevice,
  ensureGateAssignment,
} from "@/services/scan-service";
import { enforceRateLimit } from "@/lib/redis/rate-limits";

export const dynamic = "force-dynamic";

/**
 * GET /api/scanner/session — resolve the operator's active gate assignment
 * for a device (plan §14.5). Returns gate config + validity window only.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await requirePermission("scanner.use");

    const deviceCredential = req.headers.get("x-scanner-device-credential");
    if (!deviceCredential) {
      return apiError(req, "UNAUTHORIZED", "Device credential required");
    }
    await enforceRateLimit(
      "scanner",
      `session-hash:${deviceCredentialHash(deviceCredential)}`,
      { failClosed: true }
    );
    const sb = createServiceRoleClient();

    let device: { id: string; public_device_id: string; name: string; state: string } | null = null;

    if (
      defaultScannerCredentialEnabled() &&
      deviceCredential === DEFAULT_SCANNER_CREDENTIAL
    ) {
      device = await ensureDefaultScannerDevice(sb);
    } else {
      const { data: found } = await sb
        .from("scanner_devices")
        .select("id, public_device_id, name, state")
        .eq("credential_hash", deviceCredentialHash(deviceCredential))
        .maybeSingle();
      device = found;
    }

    if (!device || device.state !== "ACTIVE") {
      return apiError(req, "UNAUTHORIZED", "Device is not enrolled or was revoked");
    }

    // Fetch active gates
    const { data: allGates } = await sb
      .from("gates")
      .select("id, name, gate_type, admission_policy, offline_policy, linked_event_id")
      .eq("is_active", true)
      .order("name", { ascending: true });

    let { data: assignment } = await sb
      .from("gate_assignments")
      .select(
        `gate_id, valid_from, valid_until,
         gates ( id, name, gate_type, admission_policy, offline_policy, linked_event_id )`
      )
      .eq("device_id", device.id)
      .eq("operator_user_id", ctx.userId)
      .gte("valid_until", new Date().toISOString())
      .order("valid_until", { ascending: true })
      .limit(1)
      .maybeSingle();

    // If using the default web scanner and no assignment exists, auto-assign to first active gate
    if (
      !assignment &&
      defaultScannerCredentialEnabled() &&
      deviceCredential === DEFAULT_SCANNER_CREDENTIAL &&
      allGates &&
      allGates.length > 0
    ) {
      const primaryGate = allGates[0];
      await ensureGateAssignment(sb, device.id, ctx.userId, primaryGate.id);
      assignment = {
        gate_id: primaryGate.id,
        valid_from: new Date().toISOString(),
        valid_until: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
        gates: primaryGate,
      } as unknown as typeof assignment;
    }

    const gateList = (allGates ?? []).map((g) => ({
      gateId: g.id,
      gateName: g.name,
      gateType: g.gate_type,
      admissionPolicy: g.admission_policy,
      offlinePolicy: g.offline_policy,
    }));

    if (!assignment) {
      return apiSuccess(req, {
        device: { id: device.public_device_id, name: device.name },
        assignment: null,
        gates: gateList,
      });
    }

    const gate = Array.isArray(assignment.gates) ? assignment.gates[0] : assignment.gates;
    return apiSuccess(req, {
      device: { id: device.public_device_id, name: device.name },
      assignment: {
        gateId: assignment.gate_id,
        gateName: gate?.name ?? "",
        gateType: gate?.gate_type ?? "GENERAL",
        admissionPolicy: gate?.admission_policy ?? "ONE_PER_DAY",
        offlinePolicy: gate?.offline_policy ?? "FAIL_CLOSED",
        validFrom: assignment.valid_from,
        validUntil: assignment.valid_until,
      },
      gates: gateList,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
