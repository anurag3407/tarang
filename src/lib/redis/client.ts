import "server-only";
import { Redis } from "@upstash/redis";
import { env, redisConfigured } from "@/lib/env";

let client: Redis | null = null;

/**
 * Upstash Redis client (plan §10). Returns null when Redis is not configured
 * so callers can implement their documented fallback behavior (cache miss,
 * fail-closed for critical writes).
 */
export function getRedis(): Redis | null {
  if (!redisConfigured()) return null;
  if (client) return client;
  const e = env();
  client = new Redis({
    url: e.UPSTASH_REDIS_REST_URL!,
    token: e.UPSTASH_REDIS_REST_TOKEN!,
  });
  return client;
}
