/**
 * Application error types (plan §11.11).
 *
 * Kept free of any Next.js imports so services and background workers can
 * throw typed errors without dragging the web framework into their bundle.
 * `@/lib/api` re-exports these for Route Handlers.
 */

export type ApiErrorCode =
  | "OK"
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "RATE_LIMIT_UNAVAILABLE"
  | "VALIDATION_FAILED"
  | "SOLD_OUT"
  | "INSUFFICIENT_CAPACITY"
  | "SALES_CLOSED"
  | "SALES_PAUSED"
  | "REGISTRATION_WINDOW_CLOSED"
  | "BASE_PASS_REQUIRED"
  | "BASE_PASS_EXISTS"
  | "PROFILE_INCOMPLETE"
  | "ALREADY_REGISTERED"
  | "INVALID_SIZE"
  | "INVALID_QUANTITY"
  | "TEAM_NOT_READY"
  | "TEAM_LOCKED"
  | "HOLD_EXPIRED"
  | "PAYMENT_NOT_CAPTURED"
  | "SIGNATURE_INVALID"
  | "IDEMPOTENCY_MISMATCH"
  | "DISCOUNT_INVALID"
  | "CAPACITY_BELOW_COMMITTED"
  | "VERSION_CONFLICT"
  | "FEATURE_DISABLED"
  | "MAINTENANCE"
  | "UPSTREAM_ERROR"
  | "INTERNAL";

/** Application error carrying a stable API code. */
export class AppError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}
