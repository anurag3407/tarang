import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { getRedis } from "./client";
import { redisKeys } from "./keys";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Rate-limit policies (plan §10.4).
 *
 * Limits live in Upstash Redis. When Redis is unavailable (not configured,
 * erroring, or over its plan quota):
 *   - critical writes (`failClosed`) fall back to an in-process sliding
 *     window with the same limits. Rejecting them outright would stop every
 *     sale on a Redis blip; production runs a single origin, so a per-process
 *     window enforces effectively the same budget. Only if that fallback is
 *     itself saturated with keys do they get 503 RATE_LIMIT_UNAVAILABLE.
 *   - public reads fail open.
 * Every Redis failure is logged (rate-limited) so an outage is visible.
 */

type LimitClass =
  | "login"
  | "loginIp"
  | "order"
  | "team"
  | "ask"
  | "askIp"
  | "verify"
  | "verifyIp"
  | "admin"
  | "adminIp"
  | "export"
  | "scanner"
  | "public"
  | "poll"
  | "me"
  | "auth"
  | "discount"
  | "discountIp";

/**
 * Per-IP classes are deliberately much looser than their per-user/per-email
 * twins. Campus Wi-Fi and mobile carrier NAT (Jio/Airtel CGNAT) put hundreds
 * of students behind one public address, so an IP limit sized for one person
 * locks out a whole college. The per-identity limit is the real control; the
 * IP limit only caps a single machine flooding the endpoint.
 */
const LIMITS: Record<LimitClass, { limit: number; window: string }> = {
  login: { limit: 20, window: "15 m" },
  loginIp: { limit: 1000, window: "15 m" },
  order: { limit: 30, window: "1 m" },
  team: { limit: 20, window: "10 m" },
  ask: { limit: 20, window: "1 h" },
  askIp: { limit: 500, window: "1 h" },
  verify: { limit: 10, window: "1 m" },
  verifyIp: { limit: 200, window: "1 m" },
  admin: { limit: 60, window: "1 m" },
  adminIp: { limit: 1000, window: "1 m" },
  export: { limit: 3, window: "1 h" },
  scanner: { limit: 20, window: "1 s" },
  // Content reads are served from cache; this only stops one source hammering.
  public: { limit: 5000, window: "1 m" },
  poll: { limit: 60, window: "1 m" },
  me: { limit: 120, window: "1 m" },
  // Auth callback, keyed per IP only (the user is not known yet).
  auth: { limit: 1000, window: "1 m" },
  // Discount code attempts per user: low enough that guessing codes is impractical.
  discount: { limit: 20, window: "10 m" },
  // Per IP: campus Wi-Fi and mobile carrier NAT put hundreds of buyers behind
  // one address, so this only caps bulk guessing from a single source.
  discountIp: { limit: 300, window: "10 m" },
};

const WINDOW_UNITS_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function windowMs(window: string): number {
  const [amount, unit] = window.trim().split(/\s+/);
  return Number(amount) * (WINDOW_UNITS_MS[unit] ?? 60_000);
}

/**
 * In-process sliding window used only while Redis is unavailable. Bounded so
 * a flood of distinct identifiers cannot grow memory without limit.
 */
const MEMORY_MAX_KEYS = 50_000;
const memoryHits = new Map<string, number[]>();

function memoryLimit(cls: LimitClass, identifier: string): RateLimitResult | null {
  const { limit, window } = LIMITS[cls];
  const span = windowMs(window);
  const now = Date.now();
  const key = `${cls}:${identifier}`;
  const hits = (memoryHits.get(key) ?? []).filter((t) => now - t < span);
  if (!memoryHits.has(key) && memoryHits.size >= MEMORY_MAX_KEYS) {
    // Drop expired windows; if still full, the fallback cannot track this key.
    for (const [k, v] of memoryHits) {
      if (v.every((t) => now - t >= span * 4)) memoryHits.delete(k);
    }
    if (memoryHits.size >= MEMORY_MAX_KEYS) return null;
  }
  const success = hits.length < limit;
  if (success) hits.push(now);
  memoryHits.set(key, hits);
  return {
    success,
    remaining: Math.max(0, limit - hits.length),
    reset: (hits[0] ?? now) + span,
  };
}

let lastRedisWarnAt = 0;
function warnRedisUnavailable(reason: string): void {
  const now = Date.now();
  if (now - lastRedisWarnAt < 60_000) return;
  lastRedisWarnAt = now;
  logger().warn({ reason }, "rate limiter: Redis unavailable, using in-process fallback");
}

/** Test hook: forget fallback state between cases. */
export function resetMemoryRateLimits(): void {
  memoryHits.clear();
  lastRedisWarnAt = 0;
}

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
  if (limiter) {
    try {
      const res = await limiter.limit(identifier);
      return { success: res.success, remaining: res.remaining, reset: res.reset };
    } catch (err) {
      warnRedisUnavailable(err instanceof Error ? err.message : String(err));
    }
  } else {
    warnRedisUnavailable("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not configured");
  }

  if (!opts.failClosed) {
    return { success: true, remaining: LIMITS[cls].limit, reset: 0 };
  }
  const fallback = memoryLimit(cls, identifier);
  if (!fallback) {
    throw new AppError(
      "RATE_LIMIT_UNAVAILABLE",
      "Rate limiting is temporarily unavailable. Please retry shortly."
    );
  }
  return fallback;
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
