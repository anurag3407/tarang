import type { NextRequest } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readJsonBody } from "@/lib/route-utils";
import { deviceCredentialHash } from "@/services/scan-service";

export const dynamic = "force-dynamic";

const enrollSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
  })
  .strict();

/**
 * POST /api/scanner/devices — enroll a scanner device (plan §14.5).
 * Requires scanner.device.manage. Returns the plaintext credential once;
 * only its hash is stored.
 */
export async function POST(req: NextRequest) {
  try {
    const ctx = await guardAdminMutation(req, "scanner.device.manage");
    const body = await readJsonBody<Record<string, unknown>>(req);
    const parsed = enrollSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Invalid device name");
    }

    const credential = randomBytes(32).toString("base64url");
    const sb = createServiceRoleClient();
    const { data: device, error } = await sb
      .from("scanner_devices")
      .insert({
        name: parsed.data.name,
        credential_hash: deviceCredentialHash(credential),
        state: "ACTIVE",
        created_by: ctx.userId,
      })
      .select("id, public_device_id")
      .single();
    if (error) {
      return apiError(req, "INTERNAL", "Could not enroll device");
    }

    return apiSuccess(
      req,
      {
        deviceId: device.public_device_id,
        credential, // shown once; store it on the device securely
      },
      201
    );
  } catch (err) {
    return apiFromError(req, err);
  }
}
