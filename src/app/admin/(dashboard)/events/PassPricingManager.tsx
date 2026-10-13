"use client";

import { useCallback, useEffect, useState } from "react";
import { Star, Tag, History } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatPaise } from "@/lib/money";
import { isPronitePassProduct } from "@/lib/pronite-pass";

interface PriceVersion {
  id: string;
  version: number;
  amountPaise: number;
  reason: string | null;
  createdAt: string;
}

interface PassProductAdmin {
  id: string;
  slug: string;
  name: string;
  description: string;
  isBasePass: boolean;
  salesState: string;
  status: string;
  currentPricePaise: number;
  currentPriceVersion: number;
  priceHistory: PriceVersion[];
  updatedAt: string;
}

export default function PassPricingManager() {
  const [products, setProducts] = useState<PassProductAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [newPriceRupees, setNewPriceRupees] = useState<number>(2000);
  const [changeReason, setChangeReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ id: string; text: string; type: "success" | "error" } | null>(null);

  const loadPasses = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pass-products");
      const body = await res.json();
      if (!body.ok) throw new Error(body.message ?? "Could not load pass products");
      setProducts(body.data.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load pass products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPasses();
  }, [loadPasses]);

  async function handlePriceSubmit(e: React.FormEvent, product: PassProductAdmin) {
    e.preventDefault();
    if (!changeReason.trim()) {
      setActionMessage({ id: product.id, text: "A change reason is required for the audit log.", type: "error" });
      return;
    }
    setBusy(true);
    setActionMessage(null);
    try {
      const res = await fetch(`/api/admin/pass-products/${product.id}/price`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          priceRupees: Number(newPriceRupees),
          reason: changeReason.trim(),
          version: product.currentPriceVersion,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "Price update failed");
      }
      setActionMessage({
        id: product.id,
        text: `Price updated to ₹${newPriceRupees} (Version ${body.data.product?.currentPriceVersion ?? ""})`,
        type: "success",
      });
      setUpdatingId(null);
      setChangeReason("");
      await loadPasses();
    } catch (err) {
      setActionMessage({
        id: product.id,
        text: err instanceof Error ? err.message : "Price update failed",
        type: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="mt-8 text-center font-bold text-black/60">Loading pass products…</p>;
  }

  if (error) {
    return <p className="mt-4 border-4 border-black bg-neo-accent p-3 font-bold">{error}</p>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-tight">
          Festival Passes &amp; Dynamic Pricing
        </h2>
        <p className="mt-1 text-sm font-bold text-black/70">
          Manage dynamic pricing with immutable price versioning for the Pronite Pass.
          Gate entry QR codes are generated for confirmed Pronite Passes only.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {products.map((p) => {
          const isDelegate = isPronitePassProduct(p);

          return (
            <div
              key={p.id}
              className={`flex flex-col justify-between border-8 border-black p-6 shadow-neo-lg ${
                isDelegate ? "bg-black text-white" : "bg-white text-black"
              }`}
            >
              <div>
                {/* Header tag */}
                <div className="flex items-center justify-between">
                  <span
                    className={`inline-flex items-center gap-1 border-2 border-black px-2.5 py-0.5 text-xs font-black uppercase ${
                      isDelegate ? "bg-neo-secondary text-black" : "bg-neo-muted text-black"
                    }`}
                  >
                    {isDelegate ? <Star className="h-3 w-3 fill-black" /> : <Tag className="h-3 w-3" />}
                    {isDelegate ? "Gate Entry Pass (QR Issued)" : "Retired — not on sale"}
                  </span>
                  <span
                    className={`text-xs font-black uppercase ${
                      isDelegate ? "text-neo-secondary" : "text-black/60"
                    }`}
                  >
                    {p.salesState} · {p.status}
                  </span>
                </div>

                <h3 className="mt-3 text-2xl font-black uppercase tracking-tight">{p.name}</h3>
                <p
                  className={`mt-1 text-xs font-bold ${
                    isDelegate ? "text-white/70" : "text-black/70"
                  }`}
                >
                  {p.description}
                </p>

                {/* Price Display */}
                <div
                  className={`mt-4 border-4 p-4 ${
                    isDelegate
                      ? "border-neo-secondary/40 bg-zinc-900"
                      : "border-black bg-neo-cream"
                  }`}
                >
                  <div className="flex items-baseline justify-between">
                    <div>
                      <span
                        className={`text-[10px] font-black uppercase tracking-widest ${
                          isDelegate ? "text-white/60" : "text-black/60"
                        }`}
                      >
                        Current Dynamic Price
                      </span>
                      <p
                        className={`text-3xl font-black ${
                          isDelegate ? "text-neo-secondary" : "text-black"
                        }`}
                      >
                        {formatPaise(p.currentPricePaise)}
                      </p>
                    </div>
                    <span
                      className={`text-xs font-mono font-bold uppercase ${
                        isDelegate ? "text-white/50" : "text-black/50"
                      }`}
                    >
                      Version {p.currentPriceVersion}
                    </span>
                  </div>
                </div>

                {/* Status messages */}
                {actionMessage && actionMessage.id === p.id && (
                  <p
                    className={`mt-3 border-2 border-black px-3 py-2 text-xs font-black uppercase ${
                      actionMessage.type === "success"
                        ? "bg-green-300 text-black"
                        : "bg-neo-accent text-black"
                    }`}
                  >
                    {actionMessage.text}
                  </p>
                )}

                {/* Update Price Form */}
                {updatingId === p.id ? (
                  <form onSubmit={(e) => handlePriceSubmit(e, p)} className="mt-4 border-2 border-dashed border-black/40 p-4 space-y-3">
                    <h4 className="text-xs font-black uppercase tracking-wider">
                      Set New Dynamic Price Version:
                    </h4>

                    <label className="block text-xs font-black uppercase">
                      New Price (₹ INR)
                      <input
                        type="number"
                        min={0}
                        required
                        value={newPriceRupees}
                        onChange={(e) => setNewPriceRupees(Number(e.target.value))}
                        className="mt-1 w-full border-2 border-black bg-white px-3 py-1.5 text-sm font-bold text-black focus:outline-none"
                      />
                    </label>

                    <label className="block text-xs font-black uppercase">
                      Change Reason (Audit Log)
                      <input
                        type="text"
                        required
                        placeholder="e.g. Early Bird tier, Flash promo, Late price"
                        value={changeReason}
                        onChange={(e) => setChangeReason(e.target.value)}
                        className="mt-1 w-full border-2 border-black bg-white px-3 py-1.5 text-sm font-bold text-black focus:outline-none"
                      />
                    </label>

                    <div className="flex gap-2 pt-2">
                      <Button type="submit" variant="primary" className="flex-1 text-xs" disabled={busy}>
                        {busy ? "Saving…" : "Save New Price"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="text-xs text-black"
                        onClick={() => {
                          setUpdatingId(null);
                          setChangeReason("");
                        }}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                    </div>
                  </form>
                ) : null}

                {/* Price History List */}
                {p.priceHistory && p.priceHistory.length > 1 && (
                  <div className="mt-4 pt-3 border-t-2 border-black/20">
                    <p className={`text-[10px] font-black uppercase tracking-wider mb-1 flex items-center gap-1 ${isDelegate ? "text-white/60" : "text-black/60"}`}>
                      <History className="h-3 w-3" /> Price Change Audit Log:
                    </p>
                    <ul className="space-y-1 text-xs font-mono">
                      {p.priceHistory.slice(0, 3).map((h) => (
                        <li key={h.id} className={`flex justify-between ${isDelegate ? "text-white/80" : "text-black/80"}`}>
                          <span>v{h.version}: {formatPaise(h.amountPaise)}</span>
                          <span className="text-[10px] truncate max-w-[140px]">{h.reason ?? "Initial"}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Action trigger */}
              {updatingId !== p.id && (
                <div className="mt-6 pt-4 border-t-2 border-black/20">
                  <Button
                    variant={isDelegate ? "secondary" : "primary"}
                    className="w-full text-xs"
                    onClick={() => {
                      setUpdatingId(p.id);
                      setNewPriceRupees(Math.round(p.currentPricePaise / 100));
                      setChangeReason("");
                      setActionMessage(null);
                    }}
                  >
                    Change Dynamic Price →
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
