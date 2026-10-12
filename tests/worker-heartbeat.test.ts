import { describe, expect, it, vi } from "vitest";
import { MockSupabase, fail, ok } from "./helpers/supabase-mock";

/**
 * The worker loop's heartbeat (plan §12.15).
 *
 * The reconciler is the safety net for every lost browser callback and every
 * lost webhook. When it stops running, nothing errors and no order is marked
 * bad — orders simply, quietly, stop resolving, which looks exactly like a slow
 * sales day. A heartbeat is the only thing that distinguishes the two, so it is
 * worth its own coverage: recorded on success, recorded WITH the error on
 * failure, and never itself able to take the worker down.
 *
 * Lives in its own file because startWorkerLoop() installs five intervals and
 * flips a module-scoped `stopping` flag on shutdown — it can only be started
 * once per module registry.
 */

const sb = new MockSupabase();
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => sb,
}));

// The workers themselves are covered in jobs-workers.e2e.test.ts. Here they are
// stubs, so the only behaviour under test is the wrapper around them.
const RECONCILER_ERROR = "reconciler exploded";
vi.mock("@/workers/hold-reaper", () => ({
  runHoldReaper: vi.fn(async () => ({ expired: 0 })),
}));
vi.mock("@/workers/outbox-dispatcher", () => ({
  runOutboxDispatcher: vi.fn(async () => ({ processed: 0, failed: 0 })),
  runEmailDispatcher: vi.fn(async () => ({ submitted: 0, failed: 0, dead: 0 })),
}));
vi.mock("@/workers/payment-reconciler", () => ({
  runPaymentReconciler: vi.fn(async () => {
    throw new Error(RECONCILER_ERROR);
  }),
}));
vi.mock("@/workers/export-worker", () => ({
  runExportWorker: vi.fn(async () => ({ processed: 0 })),
}));

const { startWorkerLoop } = await import("@/workers/main");

/** Heartbeat params keyed by worker name, from the recorded RPC calls. */
function beats(): Record<string, { p_ok?: boolean; p_error?: string | null }> {
  const out: Record<string, { p_ok?: boolean; p_error?: string | null }> = {};
  for (const call of sb.callsFor("record_worker_heartbeat")) {
    const p = call.params as {
      p_worker?: string;
      p_ok?: boolean;
      p_error?: string | null;
    };
    if (p?.p_worker) out[p.p_worker] = { p_ok: p.p_ok, p_error: p.p_error };
  }
  return out;
}

describe("worker loop heartbeat", () => {
  it("records every worker's first tick — success with p_ok, failure with the error", async () => {
    // A heartbeat write that errors must not be mistaken for a tick failure,
    // so the RPC is seeded to fail once: the loop is expected to shrug it off.
    sb.onRpc("record_worker_heartbeat", fail("heartbeat table locked"));
    sb.setFallback(ok(null));

    await startWorkerLoop();
    await vi.waitFor(() => {
      expect(Object.keys(beats()).length).toBe(5);
    });

    // Every scheduled worker reports in. A worker that never registers is
    // invisible in the table, which is why /api/admin/payment-health also
    // checks for absent names.
    const recorded = beats();
    expect(Object.keys(recorded).sort()).toEqual([
      "email",
      "exports",
      "hold-reaper",
      "outbox",
      "reconcile",
    ]);

    for (const name of ["hold-reaper", "outbox", "email", "exports"]) {
      expect(recorded[name].p_ok).toBe(true);
      expect(recorded[name].p_error ?? null).toBeNull();
    }

    // The whole point: a worker throwing on every tick is loud, not silent.
    expect(recorded.reconcile.p_ok).toBe(false);
    expect(recorded.reconcile.p_error).toContain(RECONCILER_ERROR);

    // The failing worker did not take the loop down with it — the four healthy
    // workers above are the proof, and the loop is still scheduled.
    //
    // Shutdown drains in-flight ticks and then calls process.exit(0), which
    // vitest surfaces as an unhandled rejection. Stub it so the teardown is
    // inert here, and use it to assert the drain actually completed.
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    process.emit("SIGTERM");
    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });
});
