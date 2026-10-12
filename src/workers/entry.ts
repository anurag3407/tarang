/**
 * Worker process entry (plan §5.3, §12.9).
 *
 * Run as a standalone Node process (Docker `worker` service), NOT inside the
 * Next server:
 *
 *   pnpm worker
 *
 * Uses `tsx --conditions=react-server` so the `server-only` marker modules
 * (which guard against browser bundling) resolve to no-ops in this plain
 * Node context. All handlers are idempotent and lease-based, so running more
 * than one worker is safe.
 */
import { startWorkerLoop } from "./main";
import { logger } from "@/lib/logger";

process.on("unhandledRejection", (reason) => {
  try {
    logger().error({ err: reason instanceof Error ? reason.message : String(reason) }, "worker unhandledRejection");
  } catch {
    console.error("worker unhandledRejection", reason);
  }
});

process.on("uncaughtException", (err) => {
  try {
    logger().fatal({ err: err.message, stack: err.stack }, "worker uncaughtException");
  } catch {
    console.error("worker uncaughtException", err);
  }
  process.exit(1);
});

startWorkerLoop().catch((err) => {
  console.error("worker failed to start", err);
  process.exit(1);
});
