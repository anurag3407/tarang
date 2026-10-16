import type { NextRequest } from "next/server";
import { AppError, apiError, apiFromError, apiSuccess } from "@/lib/api";
import { logger } from "@/lib/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  deviceCredentialHash,
  DEFAULT_SCANNER_CREDENTIAL,
  defaultScannerCredentialEnabled,
  ensureDefaultScannerDevice,
  ensureGateAssignment,
} from "@/services/scan-service";
import { validateMutationRequest } from "@/lib/csrf";
import { readJsonBody } from "@/lib/route-utils";
import { z } from "zod";

import { requirePermission } from "@/services/authz";
import { enforceRateLimit } from "@/lib/redis/rate-limits";

export const dynamic = "force-dynamic";

const verifyCardSchema = z.object({
  query: z.string().trim().min(1, "Enter at least 1 character to search"),
  gateId: z.string().optional(),
});

/**
 * POST /api/scanner/verify-card — gate operator verification of passes/cards by unique string, email, or pass ID.
 * Allows gate staff to verify Basic Cards (and Delegate Passes) and inspect all participant data and entry history.
 */
export async function POST(req: NextRequest) {
  try {
    const invalid = validateMutationRequest(req);
    if (invalid) return apiError(req, "BAD_REQUEST", invalid);

    const op = await requirePermission("scanner.use");

    const deviceCredential = req.headers.get("x-scanner-device-credential");
    if (!deviceCredential) {
      return apiError(req, "UNAUTHORIZED", "Scanner device credential required");
    }

    // Rate limit before the device lookup so unknown/revoked credentials
    // cannot be enumerated at full speed.
    await enforceRateLimit(
      "scanner",
      `verify-hash:${deviceCredentialHash(deviceCredential)}`,
      { failClosed: true }
    );

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
        .select("id, public_device_id, name, state")
        .eq("credential_hash", deviceCredentialHash(deviceCredential))
        .maybeSingle();
      device = found;
    }

    if (!device || device.state !== "ACTIVE") {
      return apiError(req, "UNAUTHORIZED", "Device is not enrolled or active");
    }

    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = verifyCardSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid query parameter");
    }

    const { query } = parsed.data;

    // Call verify_gate_pass_lookup RPC
    const { data: rpcResult, error: lookupError } = await sb.rpc("verify_gate_pass_lookup", {
      p_query: query,
    });
    if (lookupError) {
      // Never report "not found" for a lookup that did not run: the operator
      // would turn away a valid attendee.
      logger().error({ err: lookupError.message }, "verify_gate_pass_lookup failed");
      throw new AppError("UPSTREAM_ERROR", "Lookup is temporarily unavailable. Please retry.");
    }

    let result = rpcResult;

    // Fallback: If not found by code/email, check if query is a pass UUID
    if (!result || !result.found) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);
      if (isUuid) {
        const { data: passById } = await sb
          .from("delegate_passes")
          .select(`
            id, public_pass_code, state, festival_id, activated_at, expires_at,
            user_id,
            pass_products ( name, slug, is_base_pass )
          `)
          .eq("id", query)
          .maybeSingle();

        if (passById) {
          const prod = Array.isArray(passById.pass_products) ? passById.pass_products[0] : passById.pass_products;
          // profiles has no FK to delegate_passes, so it cannot be embedded.
          const { data: profile } = await sb
            .from("profiles")
            .select("display_name, college_name")
            .eq("user_id", passById.user_id)
            .maybeSingle();
          result = {
            found: true,
            passId: passById.id,
            publicPassCode: passById.public_pass_code,
            state: passById.state,
            productName: prod?.name ?? "Festival Pass",
            productSlug: prod?.slug ?? "",
            isBasePass: Boolean(prod?.is_base_pass),
            displayName: profile?.display_name ?? null,
            collegeName: profile?.college_name ?? null,
            email: undefined,
            activatedAt: passById.activated_at,
            expiresAt: passById.expires_at,
          };
        }
      }
    }

    if (!result || !result.found) {
      return apiSuccess(req, {
        found: false,
        message: "No active pass or card found matching this code/email.",
      });
    }

    // Query and record scan history for this pass
    let recentScans: { gateName: string; at: string; outcome: string }[] = [];
    let gateVerified = false;
    if (result.passId) {
      let { data: creds } = await sb
        .from("qr_credentials")
        .select("id, jti, state")
        .eq("delegate_pass_id", result.passId)
        .order("created_at", { ascending: false });
      // A reissued pass has REPLACED credentials too; the ACTIVE one wins.
      creds = [...(creds ?? [])].sort(
        (a, b) => Number(b.state === "ACTIVE") - Number(a.state === "ACTIVE")
      );

      let primaryCredId = creds?.[0]?.id;
      let primaryCredJti = creds?.[0]?.jti;

      // Fallback: If no qr_credential row exists for this pass yet, create one
      if (!primaryCredId) {
        const { data: passRow } = await sb
          .from("delegate_passes")
          .select("id, festival_id, expires_at")
          .eq("id", result.passId)
          .maybeSingle();

        if (passRow?.festival_id) {
          let expiresAt = passRow.expires_at;
          if (!expiresAt) {
            const { data: festival } = await sb
              .from("festivals")
              .select("ends_at")
              .eq("id", passRow.festival_id)
              .maybeSingle();
            expiresAt =
              festival?.ends_at ??
              new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
          }

          const newJti = crypto.randomUUID();
          const { data: newCred } = await sb
            .from("qr_credentials")
            .insert({
              delegate_pass_id: result.passId,
              festival_id: passRow.festival_id,
              jti: newJti,
              key_id: "lookup-backfill",
              expires_at: expiresAt,
              token_digest: "lookup-scan",
              state: "ACTIVE",
            })
            .select("id, jti, state")
            .maybeSingle();

          if (newCred) {
            primaryCredId = newCred.id;
            primaryCredJti = newCred.jti;
            creds = [newCred];
          }
        }
      }

      // Record this scan attempt so it is permanently logged in the history.
      // No silent fallback to another gate (mirrors record_scan G4 semantics):
      // the attempt is only recorded against the requested gate when it is
      // active and the device/operator holds a live assignment (or the
      // dev-only default-credential bootstrap can mint one). Unknown or
      // unassigned gates yield no attempt, never a wrong-gate one.
      if (primaryCredId && parsed.data.gateId) {
        let validGateId: string;
        if (
          defaultScannerCredentialEnabled() &&
          deviceCredential === DEFAULT_SCANNER_CREDENTIAL
        ) {
          validGateId = await ensureGateAssignment(sb, device.id, op.userId, parsed.data.gateId);
        } else {
          validGateId = parsed.data.gateId;
          const { data: gateCheck } = await sb
            .from("gates")
            .select("id")
            .eq("id", validGateId)
            .eq("is_active", true)
            .maybeSingle();
          if (gateCheck) {
            const nowIso = new Date().toISOString();
            const { data: assignment } = await sb
              .from("gate_assignments")
              .select("id")
              .eq("device_id", device.id)
              .eq("gate_id", validGateId)
              .eq("operator_user_id", op.userId)
              .lte("valid_from", nowIso)
              .gte("valid_until", nowIso)
              .limit(1)
              .maybeSingle();
            if (!assignment) validGateId = "";
          } else {
            validGateId = "";
          }
        }

        gateVerified = Boolean(validGateId);
        if (gateVerified && primaryCredJti) {
          const isGood = result.state === "ACTIVE";
          const credentialState = result.state === "REFUNDED" ? "refunded" : (isGood ? "valid" : "revoked");
          
          function maskName(name: string | null): string | null {
            if (!name) return null;
            const trimmed = name.trim();
            if (trimmed.length <= 2) return `${trimmed[0]}*`;
            return `${trimmed[0]}${"*".repeat(Math.min(trimmed.length - 2, 6))}${trimmed[trimmed.length - 1]}`;
          }

          const { error: recordScanError } = await sb.rpc("record_scan", {
            p_scan_id: crypto.randomUUID(),
            p_credential_jti: primaryCredJti,
            p_gate_id: validGateId,
            p_device_id: device.id,
            p_operator_user_id: op.userId,
            p_captured_at_device: new Date().toISOString(),
            p_offline_provisional: false,
            p_credential_state: credentialState,
            p_credential_digest: "manual-lookup",
            p_pass_class: result.isBasePass ? "BASIC" : "DELEGATE",
            p_masked_name: maskName(result.displayName ?? null),
            p_override: false,
            p_override_reason: null,
          });

          if (recordScanError) {
            logger().error(
              { err: recordScanError.message, passId: result.passId },
              "record_scan failed during verify-card lookup"
            );
          }
        }
      }

      const credIds = (creds ?? []).map((c) => c.id);
      if (credIds.length > 0) {
        const { data: attempts } = await sb
          .from("scan_attempts")
          .select("captured_at_device, outcome, gates ( name )")
          .in("credential_id", credIds)
          .order("captured_at_device", { ascending: false })
          .limit(25);

        recentScans = (attempts ?? []).map((sa) => {
          const g = Array.isArray(sa.gates) ? sa.gates[0] : sa.gates;
          return {
            gateName: g?.name ?? "Main Gate",
            at: sa.captured_at_device,
            outcome: sa.outcome,
          };
        });
      }
    }

    return apiSuccess(req, {
      found: true,
      gateVerified,
      passId: result.passId,
      publicPassCode: result.publicPassCode,
      state: result.state,
      productName: result.productName,
      productSlug: result.productSlug,
      isBasePass: result.isBasePass,
      passType: result.isBasePass ? "BASIC_CARD" : "DELEGATE_PASS",
      displayName: result.displayName,
      collegeName: result.collegeName,
      email: result.email,
      activatedAt: result.activatedAt,
      expiresAt: result.expiresAt,
      recentScans,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
