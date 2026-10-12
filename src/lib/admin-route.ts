import "server-only";
import type { NextRequest } from "next/server";
import { AppError } from "./api";
import { validateMutationRequest } from "./csrf";
import { enforceRateLimit } from "./redis/rate-limits";
import { hashIdentifier, getClientIp } from "./request-context";
import { requirePermission, type AuthContext } from "@/services/authz";
import type { PermissionCode } from "@/domain/auth";

/**
 * Admin route guard (plan §11.5, §10.4).
 *
 * Every admin mutation: permission check against current DB state, origin
 * validation, JSON content-type/size check, and fail-closed per-user rate
 * limiting. Reads require the permission but skip body checks.
 */
export async function guardAdminRead(
  req: NextRequest,
  permission: PermissionCode
): Promise<AuthContext> {
  const ctx = await requirePermission(permission);
  await enforceRateLimit("admin", `user:${ctx.userId}`, { failClosed: false });
  return ctx;
}

export async function guardAdminMutation(
  req: NextRequest,
  permission: PermissionCode,
  opts: { eventId?: string; maxBodyBytes?: number } = {}
): Promise<AuthContext> {
  const invalid = validateMutationRequest(req, {
    maxBodyBytes: opts.maxBodyBytes,
  });
  if (invalid) throw new AppError("BAD_REQUEST", invalid);

  const ctx = await requirePermission(permission, opts.eventId);
  await enforceRateLimit("admin", `user:${ctx.userId}`, { failClosed: true });
  const ip = getClientIp(req);
  if (ip) {
    await enforceRateLimit("admin", `ip:${hashIdentifier(ip)}`, {
      failClosed: true,
    });
  }
  return ctx;
}

/** Map Postgres exception messages from admin RPCs to API errors. */
export function mapAdminRpcError(err: { message?: string } | null): AppError {
  const msg = err?.message ?? "";
  if (msg.includes("FORBIDDEN")) return new AppError("FORBIDDEN", "Not permitted");
  if (msg.includes("NOT_FOUND")) return new AppError("NOT_FOUND", "Not found");
  if (msg.includes("VERSION_CONFLICT"))
    return new AppError("VERSION_CONFLICT", "Record changed by someone else — reload and retry");
  if (msg.includes("STRUCTURE_LOCKED"))
    return new AppError("CONFLICT", "Structural fields are locked after first registration hold");
  if (msg.includes("CAPACITY_BELOW_COMMITTED"))
    return new AppError("CAPACITY_BELOW_COMMITTED", "Capacity cannot go below held + confirmed registrations");
  if (msg.includes("PUBLISH_INVALID"))
    return new AppError("VALIDATION_FAILED", "Cannot publish: required fields are missing");
  if (msg.includes("SCHEDULE_CONFLICT"))
    return new AppError("CONFLICT", "Venue/time conflict with another schedule entry");
  return new AppError("INTERNAL", "Operation failed");
}
