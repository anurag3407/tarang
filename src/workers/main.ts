import "server-only";
import { logger } from "@/lib/logger";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { runHoldReaper } from "./hold-reaper";
import { runOutboxDispatcher, runEmailDispatcher } from "./outbox-dispatcher";
import { runPaymentReconciler } from "./payment-reconciler";
import { runExportWorker } from "./export-worker";

/**
 * Worker main loop (plan §5.3, §12.9).
 *
 * Runs as a separate process (Docker `worker` service). QStash schedules are
 * the recovery trigger; this loop is the primary driver. All handlers are
 * idempotent and lease-based, so duplicate workers are safe.
 *
 * Every tick records a heartbeat. That matters most for the reconciler: it is
 * the safety net for lost callbacks and lost webhooks, so if it stops, the
 * only symptom is orders that quietly never resolve — indistinguishable from
 * a slow sales day. Failures are recorded too, so a worker that throws on
 * every tick is visible rather than merely silent.
 *
 * Cadence:
 *  - hold reaper: every 10s (plan §12.9: 5–15s)
 *  - outbox dispatcher: every 5s
 *  - email dispatcher: every 10s
 *  - payment reconciler: every 60s
 *  - export worker: every 30s
 */

const CADENCE_MS = {
  holdReaper: 30_000,
  outbox: 15_000,
  email: 20_000,
  reconcile: 120_000,
  exports: 60_000,
} as const;

let stopping = false;
const activeTicks = new Set<Promise<unknown>>();

function withTimeout<T>(promise: Promise<T>, ms: number, opName: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Worker ${opName} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function startWorkerLoop(): Promise<void> {
  const log = logger();
  log.info("worker loop starting");

  const timers: NodeJS.Timeout[] = [];
  const lastHeartbeatAt = new Map<string, number>();
  const HEARTBEAT_THROTTLE_MS = 60_000;

  /**
   * Best-effort: a heartbeat write must never take the worker down, and never
   * mask the real tick error that the caller is already logging.
   * Throttles successful writes so idle workers do not hammer the database.
   */
  const heartbeat = async (name: string, ok: boolean, error?: string) => {
    const now = Date.now();
    const last = lastHeartbeatAt.get(name);
    if (ok && last !== undefined && now - last < HEARTBEAT_THROTTLE_MS) {
      return;
    }
    try {
      await createServiceRoleClient().rpc("record_worker_heartbeat", {
        p_worker: name,
        p_ok: ok,
        p_error: error ?? null,
      });
      lastHeartbeatAt.set(name, now);
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err), name },
        "heartbeat write failed"
      );
    }
  };

  const schedule = (
    name: string,
    intervalMs: number,
    fn: () => Promise<unknown>
  ) => {
    let running = false;
    const tick = async () => {
      if (stopping || running) return;
      running = true;
      const tickPromise = (async () => {
        const work = fn();
        try {
          await withTimeout(work, 25_000, name);
          await heartbeat(name, true);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error({ err: message, name }, "worker tick failed");
          await heartbeat(name, false, message);
        } finally {
          // A timeout only stops waiting; the work itself keeps running. Hold
          // `running` until it settles so the next tick cannot overlap it.
          await work.catch(() => {});
          running = false;
        }
      })();

      activeTicks.add(tickPromise);
      try {
        await tickPromise;
      } finally {
        activeTicks.delete(tickPromise);
      }
    };
    timers.push(setInterval(tick, intervalMs));
    void tick();
  };

  schedule("hold-reaper", CADENCE_MS.holdReaper, () => runHoldReaper());
  schedule("outbox", CADENCE_MS.outbox, () => runOutboxDispatcher());
  schedule("email", CADENCE_MS.email, () => runEmailDispatcher());
  schedule("reconcile", CADENCE_MS.reconcile, () => runPaymentReconciler());
  schedule("exports", CADENCE_MS.exports, () => runExportWorker());

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info({ signal }, "worker loop shutting down — clearing timers and draining in-flight tasks");
    for (const t of timers) clearInterval(t);

    const drainTimeout = setTimeout(() => {
      log.warn("worker drain timed out after 10s — forcing exit");
      process.exit(1);
    }, 10_000);

    await Promise.allSettled(Array.from(activeTicks));
    clearTimeout(drainTimeout);
    log.info("worker loop shut down cleanly");
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
