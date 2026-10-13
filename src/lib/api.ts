import "server-only";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getRequestId } from "./request-context";
import type { ApiErrorCode } from "./errors";
import { AppError } from "./errors";

export type { ApiErrorCode };
export { AppError };

/**
 * API envelope (plan §11.11): every response carries a request id and a
 * stable error code so clients can branch on machine-readable codes.
 *
 * The error types themselves live in `@/lib/errors` (Next-free) so services
 * and workers can use them without importing this Route Handler module.
 */

export interface ApiErrorBody {
  ok: false;
  code: ApiErrorCode;
  message: string;
  requestId: string;
  details?: unknown;
}

export interface ApiSuccessBody<T> {
  ok: true;
  requestId: string;
  data: T;
}

const STATUS: Record<ApiErrorCode, number> = {
  OK: 200,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  RATE_LIMIT_UNAVAILABLE: 503,
  VALIDATION_FAILED: 422,
  SOLD_OUT: 409,
  INSUFFICIENT_CAPACITY: 409,
  SALES_CLOSED: 409,
  SALES_PAUSED: 409,
  REGISTRATION_WINDOW_CLOSED: 409,
  BASE_PASS_REQUIRED: 409,
  BASE_PASS_EXISTS: 409,
  PROFILE_INCOMPLETE: 409,
  ALREADY_REGISTERED: 409,
  INVALID_SIZE: 422,
  INVALID_QUANTITY: 422,
  TEAM_NOT_READY: 409,
  TEAM_LOCKED: 409,
  HOLD_EXPIRED: 409,
  PAYMENT_NOT_CAPTURED: 409,
  SIGNATURE_INVALID: 401,
  IDEMPOTENCY_MISMATCH: 409,
  DISCOUNT_INVALID: 422,
  CAPACITY_BELOW_COMMITTED: 409,
  VERSION_CONFLICT: 409,
  FEATURE_DISABLED: 403,
  MAINTENANCE: 503,
  UPSTREAM_ERROR: 502,
  INTERNAL: 500,
};

export function apiSuccess<T>(req: NextRequest, data: T, status = 200) {
  const body: ApiSuccessBody<T> = { ok: true, requestId: getRequestId(req), data };
  return NextResponse.json(body, { status });
}

export function apiError(
  req: NextRequest,
  code: ApiErrorCode,
  message: string,
  details?: unknown
) {
  const body: ApiErrorBody = {
    ok: false,
    code,
    message,
    requestId: getRequestId(req),
    ...(details !== undefined ? { details } : {}),
  };
  return NextResponse.json(body, { status: STATUS[code] ?? 500 });
}

/** Map a thrown AppError to a response. */
export function apiFromError(req: NextRequest, err: unknown) {
  if (err instanceof AppError) {
    return apiError(req, err.code, err.message, err.details);
  }
  return apiError(req, "INTERNAL", "Unexpected server error");
}
