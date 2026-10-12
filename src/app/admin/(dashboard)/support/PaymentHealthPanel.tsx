"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatPaise } from "@/lib/money";

/**
 * Payment health panel (plan §12.15).
 *
 * Two things staff cannot see anywhere else:
 *
 *  1. Whether the workers are alive. The payment reconciler is the safety net
 *     for every lost browser callback and lost webhook. When it stops, nothing
 *     errors — orders just quietly stop resolving, which looks exactly like a
 *     slow sales day.
 *  2. Captured money that could not be turned into an entitlement. Refunds are
 *     deliberately manual, so each of these is a human task, and before this
 *     panel the only way to find them was a SQL query nobody was running.
 */

interface WorkerRow {
  name: string;
  lastStartedAt: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  runs: number;
  stale: boolean;
}

interface ReviewRow {
  orderId: string;
  publicOrderCode: string;
  checkoutState: string;
  kind: string;
  razorpayPaymentId: string | null;
  amountPaise: number;
  currency: string;
  providerStatus: string | null;
  disposition: string | null;
  providerCreatedAt: string | null;
  lastObservedAt: string | null;
  orderCreatedAt: string | null;
}

interface HealthData {
  workers: WorkerRow[];
  missingWorkers: string[];
  workersUnhealthy: boolean;
  review: ReviewRow[];
  reviewCount: number;
  refundRequiredPaise: number;
}

function when(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleString("en-IN");
}

export default function PaymentHealthPanel() {
  const [data, setData] = useState<HealthData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/admin/payment-health");
      const body = await res.json();
      if (!body.ok) throw new Error(body.message ?? "Could not load payment health");
      setData(body.data as HealthData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load payment health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // Cheap enough to keep fresh while the tab is open; the reconciler ticks
    // once a minute, so anything faster would just show the same row.
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (loading) {
    return (
      <p className="border-4 border-black bg-white p-4 font-bold text-black/50">
        Loading payment health…
      </p>
    );
  }

  if (error) {
    return (
      <p className="border-4 border-black bg-neo-accent p-3 font-bold">{error}</p>
    );
  }
  if (!data) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-black uppercase tracking-tighter">
          Payment health
        </h2>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {/* Workers ------------------------------------------------------- */}
      <div
        className={`border-4 border-black p-4 ${
          data.workersUnhealthy ? "bg-neo-accent" : "bg-white"
        }`}
      >
        <div className="flex items-center gap-2">
          {data.workersUnhealthy && (
            <AlertCircle className="h-5 w-5 shrink-0" strokeWidth={3} />
          )}
          <h3 className="font-black uppercase">
            Workers{" "}
            {data.workersUnhealthy ? "— needs attention" : "— all reporting"}
          </h3>
        </div>

        {data.missingWorkers.length > 0 && (
          <p className="mt-2 text-sm font-bold">
            Never reported a heartbeat: {data.missingWorkers.join(", ")}. If this
            includes <span className="font-mono">reconcile</span>, lost webhooks
            are not being recovered.
          </p>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-xs font-bold">
            <thead>
              <tr className="border-b-2 border-black uppercase">
                <th className="py-1 pr-3">Worker</th>
                <th className="py-1 pr-3">Last success</th>
                <th className="py-1 pr-3">Fails in a row</th>
                <th className="py-1">Last error</th>
              </tr>
            </thead>
            <tbody>
              {data.workers.map((w) => (
                <tr
                  key={w.name}
                  className={`border-b border-black/20 ${
                    w.stale || w.consecutiveFailures > 0 ? "bg-white/60" : ""
                  }`}
                >
                  <td className="py-1 pr-3 font-mono">{w.name}</td>
                  <td className="py-1 pr-3">
                    {when(w.lastSuccessAt)}
                    {w.stale && " ⚠ stale"}
                  </td>
                  <td className="py-1 pr-3">{w.consecutiveFailures}</td>
                  <td className="py-1 break-all text-black/60">
                    {w.lastError ?? "—"}
                  </td>
                </tr>
              ))}
              {data.workers.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-2 text-black/50">
                    No worker has reported yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Review queue -------------------------------------------------- */}
      <div
        className={`border-4 border-black p-4 ${
          data.reviewCount > 0 ? "bg-neo-cream" : "bg-white"
        }`}
      >
        <h3 className="font-black uppercase">
          Payments needing review — {data.reviewCount}
        </h3>
        {data.refundRequiredPaise > 0 && (
          <p className="mt-1 text-sm font-black">
            Refund obligation: {formatPaise(data.refundRequiredPaise)}
          </p>
        )}
        <p className="mt-1 text-xs font-bold text-black/60">
          Captured money that could not be turned into a pass. Refunds are not
          automated — settle each of these with the payer, then refund from the
          Razorpay dashboard.
        </p>

        {data.reviewCount === 0 ? (
          <p className="mt-3 text-sm font-bold text-black/50">
            Nothing outstanding.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-xs font-bold">
              <thead>
                <tr className="border-b-2 border-black uppercase">
                  <th className="py-1 pr-3">Order</th>
                  <th className="py-1 pr-3">Amount</th>
                  <th className="py-1 pr-3">Order state</th>
                  <th className="py-1 pr-3">Disposition</th>
                  <th className="py-1 pr-3">Payment id</th>
                  <th className="py-1">Paid at</th>
                </tr>
              </thead>
              <tbody>
                {data.review.map((r) => (
                  <tr key={r.orderId} className="border-b border-black/20">
                    <td className="py-1 pr-3 font-mono">{r.publicOrderCode}</td>
                    <td className="py-1 pr-3">{formatPaise(r.amountPaise)}</td>
                    <td className="py-1 pr-3">{r.checkoutState}</td>
                    <td className="py-1 pr-3">{r.disposition ?? "—"}</td>
                    <td className="py-1 pr-3 break-all font-mono text-black/60">
                      {r.razorpayPaymentId ?? "—"}
                    </td>
                    <td className="py-1">{when(r.providerCreatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
