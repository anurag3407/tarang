"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatPaise } from "@/lib/money";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ShoppingBag,
  MapPin,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { MerchandiseProductRead } from "@/domain/content";
import type { User } from "@supabase/supabase-js";

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: { name?: string; email?: string; contact?: string };
  theme?: { color?: string };
  handler: (response: RazorpayResponse) => void | Promise<void>;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, cb: (response: unknown) => void) => void;
    };
  }
}

export function MerchandiseCheckoutModal({
  item,
  onClose,
}: {
  item: MerchandiseProductRead;
  onClose: () => void;
}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  // Gallery state
  const images = item.images && item.images.length > 0
    ? item.images
    : ["https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=800&auto=format&fit=crop&q=80"];
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  // Form state
  const [selectedSize, setSelectedSize] = useState(item.sizes?.[0] || "Standard");
  const [quantity, setQuantity] = useState(1);
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");

  // Checkout flow state
  const [phase, setPhase] = useState<
    "idle" | "creating_order" | "verifying" | "processing" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [confirmedOrderCode, setConfirmedOrderCode] = useState<string | null>(null);

  // Verification can fail after money has moved (network drop mid-verify), so
  // success is only ever shown once the order is confirmed FULFILLED
  // server-side. pollTimerRef lets unmount cancel a pending retry.
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  // Refresh idempotency key when selection changes
  useEffect(() => {
    idempotencyKeyRef.current = crypto.randomUUID();
  }, [item.id, selectedSize, quantity]);

  async function pollUntilFulfilled(orderId: string, orderCode: string, attempt = 0) {
    if (attempt > 12) {
      setConfirmedOrderCode(orderCode);
      setPhase("processing");
      return;
    }
    try {
      const res = await fetch(`/api/checkout/orders/${orderId}`);
      const body = await res.json();
      if (body.ok) {
        const status = body.data.status as string;
        if (status === "FULFILLED") {
          setConfirmedOrderCode(orderCode);
          setPhase("success");
          return;
        }
        if (status === "EXPIRED" || status === "CANCELLED") {
          setPhase("error");
          setErrorMessage(
            "This order expired before it could be confirmed. If money was deducted, it will be reconciled automatically — contact support with your payment reference if it does not appear."
          );
          return;
        }
      }
    } catch {
      // Transient; keep polling.
    }
    pollTimerRef.current = setTimeout(
      () => void pollUntilFulfilled(orderId, orderCode, attempt + 1),
      Math.min(2000 * 2 ** attempt, 15000)
    );
  }

  useEffect(() => {
    async function loadUser() {
      try {
        const sb = createClient();
        const { data } = await sb.auth.getUser();
        if (data.user) {
          setUser(data.user);
          setRecipientEmail(data.user.email ?? "");
          // fetch profile
          const { data: profile } = await sb
            .from("profiles")
            .select("display_name, phone_e164")
            .eq("user_id", data.user.id)
            .maybeSingle();
          if (profile) {
            setRecipientName(profile.display_name ?? "");
            setRecipientPhone(profile.phone_e164 ?? "");
          }
        }
      } catch {
        // user not authenticated
      } finally {
        setLoadingUser(false);
      }
    }
    void loadUser();
  }, []);

  // Total calculation
  const totalAmountPaise = item.pricePaise * quantity;

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    if (phase === "creating_order" || phase === "verifying" || phase === "processing") return;
    if (!user) {
      router.push(`/login?next=/merchandise`);
      return;
    }

    if (!recipientName.trim() || !recipientPhone.trim() || !recipientEmail.trim()) {
      setErrorMessage("Please complete all required contact details.");
      return;
    }

    setPhase("creating_order");
    setErrorMessage("");

    try {
      // 1. Create order
      const res = await fetch("/api/checkout/merchandise", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current,
        },
        body: JSON.stringify({
          productId: item.id,
          selectedSize,
          quantity,
          recipientName: recipientName.trim(),
          recipientPhone: recipientPhone.trim(),
          recipientEmail: recipientEmail.trim().toLowerCase(),
          deliveryMode: "PICKUP",
          shippingAddress: null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json.code === "PROFILE_INCOMPLETE") {
          router.push("/complete-profile");
          return;
        }
        if (json.code === "RATE_LIMITED" || json.code === "RATE_LIMIT_UNAVAILABLE") {
          throw new Error("High traffic detected. Please wait a few seconds before trying again.");
        }
        throw new Error(json.message || "Failed to initiate checkout");
      }

      const checkoutData = json.data;

      // Free item handling
      if (checkoutData.amountPaise === 0 || checkoutData.status === "FULFILLED") {
        setConfirmedOrderCode(checkoutData.publicOrderCode);
        setPhase("success");
        return;
      }

      // 2. Load Razorpay script if needed
      if (!window.Razorpay) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://checkout.razorpay.com/v1/checkout.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load Razorpay SDK"));
          document.body.appendChild(script);
        });
      }

      if (!window.Razorpay) {
        throw new Error("Payment gateway could not be loaded");
      }

      // 3. Open Razorpay Checkout widget
      const rzp = new window.Razorpay({
        key: checkoutData.razorpayKeyId,
        amount: checkoutData.amountPaise,
        currency: checkoutData.currency || "INR",
        name: "TARANG 2026 Merchandise",
        description: `${item.name} (${selectedSize}) x ${quantity}`,
        order_id: checkoutData.razorpayOrderId,
        prefill: {
          name: recipientName,
          email: recipientEmail,
          contact: recipientPhone,
        },
        theme: {
          color: "#f4eac8",
        },
        handler: async (response: RazorpayResponse) => {
          setPhase("verifying");
          try {
            const vRes = await fetch("/api/checkout/razorpay/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            const vBody = await vRes.json();
            if (!vRes.ok || !vBody.ok) {
              throw new Error(vBody.message || "Payment verification failed");
            }
            setConfirmedOrderCode(checkoutData.publicOrderCode);
            setPhase("success");
          } catch {
            // Verify failed but money may have moved — never claim success
            // here. Poll the order; success only on confirmed fulfillment.
            setPhase("processing");
            void pollUntilFulfilled(checkoutData.localOrderId, checkoutData.publicOrderCode);
          }
        },
        modal: {
          ondismiss: () => {
            setPhase("idle");
            setErrorMessage("Payment window was closed. You can retry whenever you are ready.");
            void fetch(`/api/checkout/orders/${checkoutData.localOrderId}/cancel`, { method: "POST" });
          },
        },
      });

      rzp.on("payment.failed", () => {
        setPhase("idle");
        setErrorMessage("Payment was unsuccessful. No money was deducted.");
        void fetch(`/api/checkout/orders/${checkoutData.localOrderId}/cancel`, { method: "POST" });
      });

      rzp.open();
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : "Checkout failed. Please retry.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6 backdrop-blur-sm animate-in fade-in overflow-y-auto">
      <div className="relative my-auto w-full max-w-4xl border-8 border-black bg-white dark:bg-neo-card text-black dark:text-white shadow-neo-xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-20 border-2 border-black bg-white dark:bg-neo-card p-1 text-black dark:text-white shadow-neo-sm hover:bg-neo-accent transition-colors"
          aria-label="Close modal"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Modal Content */}
        {phase === "success" ? (
          /* SUCCESS SCREEN */
          <div className="p-8 sm:p-12 text-center space-y-6 overflow-y-auto">
            <div className="mx-auto flex h-20 w-20 items-center justify-center border-4 border-black bg-neo-accent shadow-neo">
              <CheckCircle2 className="h-10 w-10 text-black" strokeWidth={3} />
            </div>

            <div className="space-y-2">
              <Badge variant="accent" className="text-xs">
                OFFICIAL FESTIVAL DROP CONFIRMED
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-black dark:text-white">
                Order Placed Successfully!
              </h2>
              <p className="font-bold text-black/70 dark:text-zinc-300 max-w-md mx-auto">
                Thank you for ordering <strong>{item.name}</strong>. Your order has been recorded and confirmed.
              </p>
            </div>

            <div className="border-4 border-black bg-neo-cream dark:bg-neo-surface p-6 max-w-md mx-auto text-left space-y-3">
              <div className="flex justify-between items-center border-b-2 border-black/20 pb-2">
                <span className="text-xs font-black uppercase text-black/60 dark:text-zinc-500">Order Code</span>
                <span className="font-mono text-sm font-black text-black dark:text-white">{confirmedOrderCode}</span>
              </div>
              <div className="flex justify-between items-center border-b-2 border-black/20 pb-2">
                <span className="text-xs font-black uppercase text-black/60 dark:text-zinc-500">Selected Item & Size</span>
                <span className="text-xs font-bold text-black dark:text-white">{item.name} ({selectedSize}) × {quantity}</span>
              </div>
              <div className="flex justify-between items-center border-b-2 border-black/20 pb-2">
                <span className="text-xs font-black uppercase text-black/60 dark:text-zinc-500">Amount Paid</span>
                <span className="font-black text-black dark:text-white">{formatPaise(totalAmountPaise)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-black uppercase text-black/60 dark:text-zinc-500">Fulfillment</span>
                <span className="text-xs font-bold text-black dark:text-white">
                  Festival Merch Counter Pickup
                </span>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-3 pt-2">
              <Button variant="primary" onClick={() => router.push("/dashboard")}>
                View in My Dashboard →
              </Button>
              <Button variant="outline" onClick={onClose}>
                Continue Shopping
              </Button>
            </div>
          </div>
        ) : phase === "processing" ? (
          /* CONFIRMING SCREEN — payment done, awaiting server confirmation */
          <div className="p-8 sm:p-12 text-center space-y-6 overflow-y-auto">
            <div className="mx-auto flex h-20 w-20 items-center justify-center border-4 border-black bg-neo-secondary shadow-neo">
              <Loader2 className="h-10 w-10 animate-spin text-black" strokeWidth={3} />
            </div>

            <div className="space-y-2">
              <Badge variant="secondary" className="text-xs">
                CONFIRMING YOUR ORDER
              </Badge>
              <h2 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-black dark:text-white">
                Payment Received
              </h2>
              <p className="font-bold text-black/70 dark:text-zinc-300 max-w-md mx-auto">
                We are confirming your payment for <strong>{item.name}</strong>. This usually takes
                a few seconds — it is safe to close this window, your dashboard will update once
                the order is confirmed.
              </p>
            </div>

            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          /* PRODUCT DETAILS & CHECKOUT FORM */
          <div className="grid grid-cols-1 md:grid-cols-12 overflow-y-auto">
            {/* Left: Multi-Image Showcase (4-5 Images) */}
            <div className="md:col-span-5 border-b-4 md:border-b-0 md:border-r-4 border-black bg-neo-cream dark:bg-neo-surface p-5 flex flex-col justify-between">
              <div>
                <div className="relative aspect-square w-full overflow-hidden border-4 border-black bg-white dark:bg-neo-card shadow-neo-sm">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={images[activeImageIndex]}
                    alt={item.name}
                    className="h-full w-full object-cover"
                  />
                  {images.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => setActiveImageIndex((p) => (p - 1 + images.length) % images.length)}
                        className="absolute left-2 top-1/2 -translate-y-1/2 border-2 border-black bg-white/90 dark:bg-neo-card/90 p-1 shadow-neo-xs hover:bg-neo-accent"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveImageIndex((p) => (p + 1) % images.length)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 border-2 border-black bg-white/90 dark:bg-neo-card/90 p-1 shadow-neo-xs hover:bg-neo-accent"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>

                {/* 4-5 Image Thumbnails Selector */}
                {images.length > 1 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {images.map((img, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setActiveImageIndex(idx)}
                        className={`relative h-14 w-14 shrink-0 overflow-hidden border-2 border-black transition-transform ${
                          idx === activeImageIndex ? "ring-2 ring-black scale-105" : "opacity-70 hover:opacity-100"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img} alt={`Thumb ${idx + 1}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 border-2 border-black bg-white dark:bg-neo-card p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-black uppercase text-black dark:text-white">
                  <ShieldCheck className="h-4 w-4 text-black dark:text-neo-secondary" />
                  <span>Official Festival Drop</span>
                </div>
                <p className="text-[11px] font-bold text-black/70 dark:text-zinc-300">
                  Premium heavyweight construction. Guaranteed authentic TARANG ’27 merchandise.
                </p>
              </div>
            </div>

            {/* Right: Product Details & Purchase Form */}
            <div className="md:col-span-7 p-6 sm:p-8 flex flex-col justify-between text-black dark:text-white">
              <form onSubmit={handleCheckout} className="space-y-5">
                {/* Header */}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="border-2 border-black bg-neo-secondary px-2 py-0.5 text-xs font-black uppercase text-black">
                      {item.category}
                    </span>
                    {item.featured && (
                      <span className="border-2 border-black bg-neo-accent px-2 py-0.5 text-xs font-black uppercase text-black">
                        Limited Drop
                      </span>
                    )}
                  </div>
                  <h2 className="mt-2 text-2xl sm:text-3xl font-black uppercase tracking-tight text-black dark:text-white">
                    {item.name}
                  </h2>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-black tracking-tight text-black dark:text-white">
                      {formatPaise(item.pricePaise)}
                    </span>
                    <span className="text-xs font-bold uppercase text-black/60 dark:text-zinc-400">
                      per item (incl. taxes)
                    </span>
                  </div>
                </div>

                {/* 3-4 lines of product description */}
                <div className="border-t-2 border-b-2 border-black/20 dark:border-white/15 py-3 space-y-1">
                  <p className="text-xs font-bold leading-relaxed text-black/80 dark:text-zinc-300">
                    {item.description}
                  </p>
                  {item.detailsMarkdown && (
                    <p className="text-[11px] font-bold text-black/60 dark:text-zinc-400 italic">
                      {item.detailsMarkdown}
                    </p>
                  )}
                </div>

                {/* Size & Quantity Selector */}
                <div className="grid grid-cols-2 gap-4">
                  {item.sizes && item.sizes.length > 0 && (
                    <div>
                      <label className="block text-xs font-black uppercase tracking-wider text-black dark:text-white mb-1.5">
                        Select Size
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {item.sizes.map((size) => (
                          <button
                            key={size}
                            type="button"
                            onClick={() => setSelectedSize(size)}
                            className={`border-2 border-black px-2.5 py-1 text-xs font-black uppercase transition-all ${
                              selectedSize === size
                                ? "bg-black text-white dark:bg-white dark:text-black shadow-neo-xs"
                                : "bg-white text-black dark:bg-neo-card dark:text-white hover:bg-neo-cream"
                            }`}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-black uppercase tracking-wider text-black dark:text-white mb-1.5">
                      Quantity
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                        className="flex h-8 w-8 items-center justify-center border-2 border-black bg-neo-cream dark:bg-neo-surface text-black dark:text-white font-black shadow-neo-xs hover:bg-white dark:hover:bg-neo-muted"
                      >
                        -
                      </button>
                      <span className="font-mono text-sm font-black w-8 text-center text-black dark:text-white">{quantity}</span>
                      <button
                        type="button"
                        onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                        className="flex h-8 w-8 items-center justify-center border-2 border-black bg-neo-cream dark:bg-neo-surface text-black dark:text-white font-black shadow-neo-xs hover:bg-white dark:hover:bg-neo-muted"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* Fulfillment Notice: Campus Pickup Only */}
                <div className="flex items-start gap-3 border-2 border-black bg-neo-cream dark:bg-neo-surface p-3 shadow-neo-xs">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-black bg-neo-accent">
                    <MapPin className="h-4 w-4 text-black" />
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider text-black dark:text-white block">
                      Campus Counter Pickup Only
                    </span>
                    <p className="text-[11px] font-bold text-black/75 dark:text-zinc-300 leading-tight mt-0.5">
                      Collect your merchandise at the festival merch counter during fest days by presenting your Order Code.
                    </p>
                  </div>
                </div>

                {/* Recipient & Contact Details */}
                <div className="space-y-2.5 border-t-2 border-black/20 dark:border-white/15 pt-3">
                  <span className="text-xs font-black uppercase tracking-wider text-black dark:text-white block">
                    Recipient Contact Details
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      required
                      type="text"
                      placeholder="Full Name *"
                      value={recipientName}
                      onChange={(e) => setRecipientName(e.target.value)}
                      className="border-2 border-black bg-white dark:bg-neo-surface px-3 py-1.5 text-xs font-bold text-black dark:text-white outline-none focus:bg-neo-cream dark:focus:bg-neo-surface"
                    />
                    <input
                      required
                      type="tel"
                      placeholder="Phone Number *"
                      value={recipientPhone}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      className="border-2 border-black bg-white dark:bg-neo-surface px-3 py-1.5 text-xs font-bold text-black dark:text-white outline-none focus:bg-neo-cream dark:focus:bg-neo-surface"
                    />
                  </div>
                  <input
                    required
                    type="email"
                    placeholder="Email Address *"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    className="w-full border-2 border-black bg-white dark:bg-neo-surface px-3 py-1.5 text-xs font-bold text-black dark:text-white outline-none focus:bg-neo-cream dark:focus:bg-neo-surface"
                  />
                </div>

                {/* Error Banner */}
                {errorMessage && (
                  <div className="flex items-center gap-2 border-2 border-black bg-red-100 dark:bg-red-950/40 p-2.5 text-xs font-bold text-red-900 dark:text-red-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {/* Footer / Submit */}
                <div className="border-t-4 border-black pt-4 flex items-center justify-between gap-4">
                  <div>
                    <span className="text-[10px] font-black uppercase text-black/60 dark:text-zinc-400 block">Total Due</span>
                    <span className="text-2xl font-black text-black dark:text-white">
                      {formatPaise(totalAmountPaise)}
                    </span>
                  </div>

                  {!loadingUser && !user ? (
                    <Button
                      type="button"
                      variant="dark"
                      className="cursor-pointer"
                      onClick={() => router.push("/login?next=/merchandise")}
                    >
                      Sign In to Order →
                    </Button>
                  ) : (
                    <button
                      type="submit"
                      disabled={
                        phase === "creating_order" || phase === "verifying"
                      }
                      className="flex items-center gap-2 border-4 border-black bg-neo-accent px-6 py-2.5 text-sm font-black uppercase tracking-wider text-black shadow-neo transition-transform duration-100 hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none cursor-pointer disabled:opacity-50"
                    >
                      {phase === "creating_order" || phase === "verifying" ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Processing…
                        </>
                      ) : (
                        <>
                          <ShoppingBag className="h-4 w-4" />
                          Complete Order
                        </>
                      )}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
