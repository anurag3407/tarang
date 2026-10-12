import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { logger } from "@/lib/logger";
import { invalidateAvailability } from "@/lib/redis/availability";
import { getCurrentFestivalId } from "@/repositories/public-content";

/**
 * Hold reaper worker (plan §12.9).
 *
 * Expires capacity holds whose window has passed. The SQL function uses
 * FOR UPDATE SKIP LOCKED so concurrent runs (worker loop + QStash recovery
 * endpoint) are safe. Never makes provider HTTP calls while holding locks.
 */
export async function runHoldReaper(opts: { batchSize?: number } = {}): Promise<{
  expired: number;
}> {
  const log = logger();
  const sb = createServiceRoleClient();
  const batchSize = opts.batchSize ?? 100;

  const { data, error } = await sb.rpc("expire_holds_batch", {
    p_batch_size: batchSize,
  });
  if (error) {
    log.error({ err: error.message }, "hold reaper failed");
    return { expired: 0 };
  }

  const result = (data ?? { expired: 0, inventory: [] }) as {
    expired: number;
    inventory: { eventId: string }[];
  };

  // Refresh availability badges for any event whose inventory changed.
  if (result.expired > 0) {
    const festivalId = await getCurrentFestivalId();
    if (festivalId) {
      for (const inv of result.inventory ?? []) {
        await invalidateAvailability(festivalId, inv.eventId);
      }
    }
    log.info({ expired: result.expired }, "expired capacity holds");
  }

  return { expired: result.expired };
}
