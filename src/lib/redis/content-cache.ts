import "server-only";
import { getRedis } from "./client";
import { redisKeys } from "./keys";

/**
 * Content + availability cache (plan §10.2, §10.3).
 *
 * Redis is advisory for public badges; checkout always runs the conditional
 * PostgreSQL update. Reads fail as misses (never whole-site errors).
 */

export interface AvailabilitySnapshot {
  capacityUnits: number;
  heldUnits: number;
  confirmedUnits: number;
  availableUnits: number;
  unitLabel: "team" | "participant";
  inventoryVersion: number;
  updatedAt: string;
}

const CONTENT_TTL = {
  events: 60,
  schedule: 60,
  notices: 30,
  feature: 5,
} as const;

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    return (await redis.get<T>(key)) ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch {
    // Cache write failure is non-fatal; TTL remains the safety net.
  }
}

export async function cacheDel(key: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(key);
  } catch {
    // Ignore; TTL expiry will clean up.
  }
}

export async function getAvailability(
  festivalId: string,
  eventId: string
): Promise<AvailabilitySnapshot | null> {
  return cacheGet<AvailabilitySnapshot>(
    redisKeys.availability(festivalId, eventId)
  );
}

export async function setAvailability(
  festivalId: string,
  eventId: string,
  snapshot: AvailabilitySnapshot,
  salesOpen: boolean
): Promise<void> {
  await cacheSet(
    redisKeys.availability(festivalId, eventId),
    snapshot,
    salesOpen ? 8 : 30
  );
}

/** Feature flag read with 5s TTL and Postgres fallback handled by caller. */
export async function getFeatureFlagCache(
  festivalId: string,
  key: string
): Promise<boolean | null> {
  return cacheGet<boolean>(redisKeys.feature(festivalId, key));
}

export async function setFeatureFlagCache(
  festivalId: string,
  key: string,
  enabled: boolean
): Promise<void> {
  await cacheSet(redisKeys.feature(festivalId, key), enabled, CONTENT_TTL.feature);
}

export const contentTtl = CONTENT_TTL;
