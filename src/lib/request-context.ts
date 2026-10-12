import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

/**
 * Request context helpers (plan §10.5).
 *
 * Trusted client IP: we only trust `CF-Connecting-IP` when the request has
 * passed through Cloudflare + Nginx (which overwrite forwarded headers). In
 * local development we fall back to the socket address. The application never
 * trusts an arbitrary client-supplied `X-Forwarded-For`.
 */

export function getRequestId(req: NextRequest): string {
  return req.headers.get("x-request-id") ?? randomUUID();
}

/** Best-effort client IP. Nginx sets CF-Connecting-IP from the real client. */
export function getClientIp(req: NextRequest): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const fwd = req.headers.get("x-real-ip");
  if (fwd) return fwd;
  return "unknown";
}

/** Keyed hash of an identifier for rate limiting / audit (never raw). */
export function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

/** Short user-agent summary for audit rows. */
export function userAgentSummary(req: NextRequest): string {
  const ua = req.headers.get("user-agent") ?? "";
  return ua.slice(0, 200);
}
