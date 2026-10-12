import "server-only";
import { cacheDel } from "@/lib/redis/content-cache";
import { redisKeys } from "@/lib/redis/keys";

/**
 * Availability cache invalidation (plan §10.3).
 *
 * Redis-only — deliberately kept out of `@/lib/invalidation` (which imports
 * `next/cache`) so background workers can call it without dragging the Next
 * server into their bundle.
 */
export async function invalidateAvailability(
  festivalId: string,
  eventId: string
): Promise<void> {
  await cacheDel(redisKeys.availability(festivalId, eventId));
}
