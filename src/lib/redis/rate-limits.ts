import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "./client";
import { redisKeys } from "./keys";
import { AppError } from "@/lib/errors";

/**
 * Rate-limit policies (plan §10.4).
 *
 * Upstash Ratelimit permits requests on timeout by default; for critical
 * writes we wrap the check so timeout/unavailability produces a controlled
 * `503 RATE_LIMIT_UNAVAILABLE` (fail closed) instead of letting traffic
 * through. Public reads fail open on Redis errors.
 */

type LimitClass =
  | "login"
  | "order"
  | "team"
  | "ask"
  | "verify"
  | "admin"
  | "export"
  | "scanner"
  | "public"
  | "poll"
  | "me"
  | "auth";

const LIMITS: Record<LimitClass, { limit: number; window: string }> = {
  login: { limit: 20, window: "15 m" },
  order: { limit: 30, window: "1 m" },
  team: { limit: 20, window: "10 m" },
  ask: { limit: 20, window: "1 h" },
  verify: { limit: 10, window: "1 m" },
  admin: { limit: 60, window: "1 m" },
  export: { limit: 3, window: "1 h" },
  scanner: { limit: 20, window: "1 s" },
  public: { limit: 300, window: "1 m" },
  poll: { limit: 60, window: "1 m" },
  me: { limit: 120, window: "1 m" },
  auth: { limit: 120, window: "1 m" },
};

const limiters = new Map<LimitClass, Ratelimit>();

function getLimiter(cls: LimitClass): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  let limiter = limiters.get(cls);
  if (!limiter) {
    const { limit, window } = LIMITS[cls];
    limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, window as never),
      prefix: redisKeys.ratelimit(cls, ""),
      analytics: false,
    });
    limiters.set(cls, limiter);
  }
  return limiter;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
}

/**
 * Check a rate limit. `failClosed` controls behavior when Redis is
 * unavailable: critical writes fail closed (throw RATE_LIMIT_UNAVAILABLE),
 * public reads fail open (allow).
 */
export async function checkRateLimit(
  cls: LimitClass,
  identifier: string,
  opts: { failClosed?: boolean } = {}
): Promise<RateLimitResult> {
  const limiter = getLimiter(cls);
  if (!limiter) {
    if (opts.failClosed) {
      throw new AppError(
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting is temporarily unavailable. Please retry shortly."
      );
    }
    return { success: true, remaining: LIMITS[cls].limit, reset: 0 };
  }
  try {
    const res = await limiter.limit(identifier);
    return { success: res.success, remaining: res.remaining, reset: res.reset };
  } catch {
    if (opts.failClosed) {
      throw new AppError(
        "RATE_LIMIT_UNAVAILABLE",
        "Rate limiting is temporarily unavailable. Please retry shortly."
      );
    }
    return { success: true, remaining: LIMITS[cls].limit, reset: 0 };
  }
}

/** Convenience guard that throws RATE_LIMITED when the limit is exceeded. */
export async function enforceRateLimit(
  cls: LimitClass,
  identifier: string,
  opts: { failClosed?: boolean } = {}
): Promise<void> {
  const res = await checkRateLimit(cls, identifier, opts);
  if (!res.success) {
    throw new AppError("RATE_LIMITED", "Too many requests. Please slow down.");
  }
}
