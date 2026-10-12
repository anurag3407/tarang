import "server-only";
import { revalidateTag } from "next/cache";
import { cacheDel } from "@/lib/redis/content-cache";
import { redisKeys } from "@/lib/redis/keys";
import { invalidateAvailability } from "@/lib/redis/availability";

export { invalidateAvailability };

/**
 * Content invalidation (plan §11.10, §10.6).
 *
 * After every admin content write we invalidate both the Next.js cache tags
 * (shared cache handler, all processes/origins) and the Redis content keys.
 * Next 16 requires the second profile argument on revalidateTag.
 */
export function invalidateContentTags(
  festivalId: string,
  kinds: ("events" | "schedule" | "notices" | "sponsors" | "merchandise")[]
): void {
  for (const kind of kinds) {
    revalidateTag(`festival:${festivalId}:${kind}`, "max");
  }
}

export async function invalidateContentCache(
  festivalId: string,
  kinds: ("events" | "schedule" | "notices" | "sponsors" | "merchandise")[]
): Promise<void> {
  invalidateContentTags(festivalId, kinds);
  // Redis content keys are versioned; delete the current best-effort keys.
  // TTL (30–60s) is the safety net for anything we miss.
  for (const kind of kinds) {
    const keyFn =
      kind === "events"
        ? redisKeys.contentEvents
        : kind === "schedule"
          ? redisKeys.contentSchedule
          : kind === "notices"
            ? redisKeys.contentNotices
            : redisKeys.contentEvents;
    for (const version of ["current", "1", "2", "3"]) {
      await cacheDel(keyFn(festivalId, version));
    }
  }
}

