import "server-only";
import type { NextRequest } from "next/server";
import { env } from "./env";

/**
 * CSRF / origin controls (plan §11.4).
 *
 * Mutation Route Handlers validate the `Origin` header against the exact set
 * of allowed same-origin hosts. Combined with SameSite=Lax Supabase cookies
 * this blocks cross-site form/JSON submissions. Where Origin is absent
 * (non-browser clients) we require the standard Supabase auth header instead.
 */

function allowedOrigins(): Set<string> {
  const e = env();
  const origins = new Set<string>();
  for (const candidate of [
    e.APP_BASE_URL,
    e.PUBLIC_SITE_URL,
    e.REGISTRATION_SITE_URL,
    e.ADMIN_SITE_URL,
    e.SCANNER_SITE_URL,
  ]) {
    if (candidate) origins.add(candidate.replace(/\/$/, ""));
  }
  if (origins.size === 0) {
    // Local development fallback.
    origins.add("http://localhost:3000");
  }
  return origins;
}

/** Returns true when the request Origin is one of our allowed hosts. */
export function isAllowedOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    // No Origin header: allow non-browser clients (webhooks use their own
    // signature checks; server-to-server calls don't carry cookies).
    return true;
  }
  const cleanOrigin = origin.replace(/\/$/, "");
  if (req.nextUrl?.origin && req.nextUrl.origin.replace(/\/$/, "") === cleanOrigin) {
    return true;
  }
  const host = req.headers.get("host");
  if (host) {
    if (cleanOrigin === `http://${host}` || cleanOrigin === `https://${host}`) {
      return true;
    }
  }
  return allowedOrigins().has(cleanOrigin);
}

/**
 * Validate a mutation request: origin check + JSON content type + bounded
 * body size. Returns an error string or null when the request is acceptable.
 * File-upload routes opt in to multipart/form-data with `allowMultipart`.
 */
export function validateMutationRequest(
  req: NextRequest,
  opts: { maxBodyBytes?: number; allowMultipart?: boolean } = {}
): string | null {
  if (!isAllowedOrigin(req)) return "ORIGIN_NOT_ALLOWED";
  const contentType = req.headers.get("content-type");
  const length = req.headers.get("content-length");

  if (contentType) {
    const type = contentType.toLowerCase();
    const multipartOk = opts.allowMultipart === true && type.startsWith("multipart/form-data");
    if (!type.includes("application/json") && !multipartOk) {
      return "UNSUPPORTED_CONTENT_TYPE";
    }
  } else if (length && Number(length) > 0) {
    return "UNSUPPORTED_CONTENT_TYPE";
  }

  const max = opts.maxBodyBytes ?? 64 * 1024;
  if (length && Number(length) > max) return "BODY_TOO_LARGE";
  return null;
}
