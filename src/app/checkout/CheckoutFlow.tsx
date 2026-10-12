"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { formatPaise } from "@/lib/money";
import { ensureRazorpayLoaded } from "@/lib/razorpay-loader";

/**
 * Base pass checkout flow (plan §12.6).
 *
 * 1. One idempotency key per logical purchase attempt, reused on retries.
 * 2. Server returns the authoritative amount + Razorpay order id.
 * 3. Razorpay Checkout opens with provider order id + public key only.
 * 4. Success callback goes to the server verify endpoint (never trusted).
 * 5. Poll local order state with backoff; closing the tab is safe.
 *
 * On messaging: nothing here may assert that money did not move. The SDK's
 * client-side failure events are hints, not settlement — a delayed debit, an
 * authorization without capture, or a reversal all produce them. So a failure
 * says "we could not confirm", keeps polling, and offers a retry that reuses
 * the SAME idempotency key: the retry lands on the same Razorpay order, which
 * the provider will not let the user pay twice. The key is regenerated in
 * exactly one place — an order the provider never saw a payment for.
 */

/**
 * Shown when a client-side event says the payment failed. It may be wrong, so
 * the wording holds in both directions.
 */
const UNCONFIRMED_MESSAGE =
  "We could not confirm the payment. If your bank shows a debit, do not pay again — we are checking the status.";

/** The user closed the Razorpay modal. A UPI collect request may be in flight. */
const DISMISSED_MESSAGE =
  "Payment window closed. If your bank has already debited you, do not pay again — we will confirm it shortly.";

/** A sweeper gave up on the order, but the reconciler still re-checks it. */
const RECOVERING_MESSAGE =
  "We have seen a payment on this order and are confirming it with the bank. Do not pay again — your pass will appear here.";

/** Captured money that no automated path can turn into a pass. */
const REVIEW_MESSAGE =
  "Your payment reached us, but we could not issue the pass automatically. Our team has been alerted and will resolve it — please do not pay again.";

interface PassProduct {
  id: string;
  name: string;
  description: string;
  amountPaise: number;
  salesState: string;
}

interface CheckoutData {
  localOrderId: string;
  publicOrderCode: string;
  razorpayOrderId: string | null;
  razorpayKeyId: string | null;
  amountPaise: number;
  currency: string;
  expiresAt: string | null;
  status: string;
}

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, cb: (response: unknown) => void) => void;
    };
  }
}

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export default function CheckoutFlow() {
  const router = useRouter();
  const [product, setProduct] = useState<PassProduct | null>(null);
  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "ready" | "creating" | "paying" | "verifying" | "processing" | "done" | "review" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the provider has been seen to hold a payment for this order. */
  const paymentSeenRef = useRef(false);

  const [existingPass, setExistingPass] = useState<string | null>(null);

  // Load the pass product and check if user already has an active pass
  useEffect(() => {
    (async () => {
      try {
        // 1. Check if user already holds an active pass
        try {
          const passRes = await fetch("/api/me/passes");
          if (passRes.ok) {
            const passBody = await passRes.json();
            const active = (passBody.data?.passes as { state: string; productName: string }[] | undefined)?.find(
              (p) => p.state === "ACTIVE"
            );
            if (active) {
              setExistingPass(active.productName || "Basic Pass");
            }
          }
        } catch {
          // Ignore auth errors for public browse
        }

        // 2. Load pass products
        const res = await fetch("/api/public/pass-products");
        const body = await res.json();
        if (!body.ok) throw new Error("Could not load pass products");
        const base = (body.data.products as PassProduct[]).find(
          (p) => p.salesState === "OPEN" && (p.amountPaise === 20000 || p.name.toLowerCase().includes("basic") || (p as unknown as { isBasePass?: boolean }).isBasePass)
        ) ?? (body.data.products as PassProduct[]).find((p) => p.salesState === "OPEN");
        setProduct(base ?? null);
        setPhase(base ? "ready" : "error");
        if (!base) setMessage("Basic pass sales are not open right now.");
      } catch (err) {
        setPhase("error");
        setMessage(err instanceof Error ? err.message : "Could not load products");
      }
    })();
  }, []);

  // Load the Razorpay script once.
  useEffect(() => {
    if (document.getElementById("razorpay-sdk")) return;
    const script = document.createElement("script");
    script.id = "razorpay-sdk";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  // The poll recurses through a ref so the callback never references itself
  // before it is declared (keeps the compiler's immutability check happy).
  const pollRef = useRef<((orderId: string, attempt?: number) => Promise<void>) | null>(null);

  const pollOrderStatus = useCallback(
    async (orderId: string, attempt = 0) => {
      if (attempt > 12) {
        setPhase("processing");
        setMessage(
          paymentSeenRef.current
            ? RECOVERING_MESSAGE
            : "Still processing — it's safe to close this page. Your dashboard will update."
        );
        return;
      }
      try {
        const res = await fetch(`/api/checkout/orders/${orderId}`);
        const body = await res.json();
        if (body.ok) {
          const status = body.data.status as string;
          if (body.data.paymentObserved === true) paymentSeenRef.current = true;

          if (status === "FULFILLED") {
            setPhase("done");
            setMessage("Payment confirmed! Your delegate pass is active.");
            return;
          }

          // Money we hold that no automated path can turn into a pass. This is
          // terminal for the user but it is not a failure, and it must never
          // surface as a retry prompt — paying again would be a second debit.
          if (body.data.underReview === true) {
            setPhase("review");
            setMessage(REVIEW_MESSAGE);
            return;
          }

          if (status === "EXPIRED" || status === "CANCELLED") {
            // A sweeper gave up, but the reconciler keeps re-checking swept
            // orders for a bounded window (migration 0013). If the provider
            // has a payment for this order, that recovery is still pending —
            // sending the user back to a fresh order here is what produces a
            // duplicate charge, so keep waiting instead.
            if (paymentSeenRef.current) {
              setPhase("processing");
              setMessage(RECOVERING_MESSAGE);
            } else {
              setPhase("error");
              setMessage("This order expired. Please start again.");
              idempotencyKeyRef.current = newIdempotencyKey();
              return;
            }
          }
        }
      } catch {
        // Transient; keep polling.
      }
      const delay = Math.min(2000 * 2 ** attempt, 15000);
      pollTimerRef.current = setTimeout(() => void pollRef.current?.(orderId, attempt + 1), delay);
    },
    []
  );

  useEffect(() => {
    pollRef.current = pollOrderStatus;
  }, [pollOrderStatus]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const openRazorpay = useCallback(
    async (data: CheckoutData) => {
      setPhase("paying");
      const loaded = await ensureRazorpayLoaded();
      const RazorpayCtor = window.Razorpay;
      if (!loaded || !RazorpayCtor) {
        setPhase("error");
        setMessage("Payment SDK failed to load. Please check your connection and retry.");
        return;
      }
      const rzp = new RazorpayCtor({
        key: data.razorpayKeyId,
        order_id: data.razorpayOrderId,
        amount: data.amountPaise,
        currency: data.currency,
        name: "PULSE 2026",
        description: "Base Delegate Pass",
        prefill: {},
        theme: { color: "#ff6b6b" },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          setPhase("verifying");
          try {
            const res = await fetch("/api/checkout/razorpay/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            const body = await res.json();
            if (!res.ok || !body.ok) {
              throw new Error(body.message ?? "Verification failed");
            }
            setPhase("processing");
            setMessage("Verifying your payment…");
            pollOrderStatus(data.localOrderId);
          } catch (err) {
            setPhase("processing");
            setMessage(
              err instanceof Error
                ? `${err.message} — checking with the provider…`
                : "Checking payment status…"
            );
            pollOrderStatus(data.localOrderId);
          }
        },
        modal: {
          ondismiss: () => {
            // Keep polling: a UPI collect request can already be with the PSP,
            // so a closed modal does not prove nothing was charged. The retry
            // stays available and reuses this same order.
            setPhase("ready");
            setMessage(DISMISSED_MESSAGE);
            pollOrderStatus(data.localOrderId);
          },
        },
      });
      rzp.on("payment.failed", () => {
        // A client-side event, not settlement. Do not claim the money is safe
        // and do not stop watching — the server decides.
        setPhase("ready");
        setMessage(UNCONFIRMED_MESSAGE);
        pollOrderStatus(data.localOrderId);
      });
      rzp.open();
    },
    [pollOrderStatus]
  );

  const startCheckout = useCallback(async () => {
    if (!product) return;
    setPhase("creating");
    setMessage("");
    try {
      const res = await fetch("/api/checkout/base-pass", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": idempotencyKeyRef.current,
        },
        body: JSON.stringify({ passProductId: product.id }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        if (body.code === "PROFILE_INCOMPLETE") {
          router.push("/complete-profile");
          return;
        }
        throw new Error(body.message ?? "Checkout failed");
      }
      const data = body.data as CheckoutData;
      setCheckout(data);

      if (data.status === "FULFILLED") {
        setPhase("done");
        setMessage("You already have an active pass!");
        return;
      }

      if (data.amountPaise === 0) {
        pollOrderStatus(data.localOrderId);
        setPhase("processing");
        return;
      }

      if (!data.razorpayOrderId || !data.razorpayKeyId) {
        setPhase("processing");
        setMessage("Preparing payment… this may take a moment.");
        pollOrderStatus(data.localOrderId);
        return;
      }

      openRazorpay(data);
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Checkout failed");
    }
  }, [product, pollOrderStatus, openRazorpay]);

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="border-8 border-black bg-white p-8 shadow-neo-lg">
        <h1 className="text-3xl font-black uppercase tracking-tighter">
          Basic Festival Card
        </h1>
        <p className="mt-2 text-sm font-bold text-black/70">
          Standard 5-day campus entry card. Required before registering for competitions.
        </p>

        <div className="mt-4 border-2 border-black bg-neo-secondary p-3 text-xs font-bold text-black">
          <p className="font-black uppercase">Looking for Star Concerts &amp; Pro Shows?</p>
          <Link href="/delegate-card" className="mt-1 inline-block font-black underline hover:text-white">
            Get the All-Access Delegate Card →
          </Link>
        </div>

        {existingPass ? (
          <div className="mt-6 border-4 border-black bg-green-50 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-white font-black text-xs">
                ✓
              </span>
              <h2 className="text-sm font-black uppercase text-green-800">
                You Already Have An Active Card
              </h2>
            </div>
            <p className="text-xs font-bold text-black/80 leading-relaxed">
              Your account already holds an active <strong>{existingPass}</strong>. You do not need to buy another basic card! You can directly register for any competition.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <Button
                variant="primary"
                className="w-full text-xs"
                onClick={() => router.push("/events")}
              >
                Browse &amp; Register for Competitions →
              </Button>
              <Button
                variant="outline"
                className="w-full text-xs text-black"
                onClick={() => router.push("/dashboard")}
              >
                Go to My Dashboard →
              </Button>
            </div>
          </div>
        ) : (
          <>
            {product && (
              <div className="mt-6 border-4 border-black bg-neo-cream p-4">
                <div className="flex items-center justify-between">
                  <span className="font-black uppercase">{product.name}</span>
                  <span className="text-2xl font-black">
                    {formatPaise(product.amountPaise)}
                  </span>
                </div>
                <p className="mt-1 text-sm font-bold text-black/60">
                  {product.description}
                </p>
              </div>
            )}

            {checkout && phase !== "ready" && (
              <p className="mt-3 text-xs font-bold uppercase text-black/50">
                Order {checkout.publicOrderCode}
              </p>
            )}

            {message && (
              <p
                className={`mt-4 border-4 border-black px-3 py-2 text-sm font-bold ${
                  phase === "error"
                    ? "bg-neo-accent"
                    : phase === "review"
                      ? "bg-neo-cream"
                      : "bg-neo-secondary"
                }`}
                role="status"
              >
                {message}
              </p>
            )}

            <div className="mt-6">
              {phase === "done" ? (
                <Button variant="secondary" className="w-full" onClick={() => router.push("/dashboard")}>
                  Go to my dashboard
                </Button>
              ) : phase === "review" ? (
                // Deliberately no pay button: we already hold this user's money.
                <div className="space-y-2">
                  <Button variant="secondary" className="w-full" onClick={() => router.push("/dashboard")}>
                    Go to my dashboard
                  </Button>
                  <p className="text-center text-xs font-bold text-black/60">
                    Need it sooner?{" "}
                    <Link href="/ask" className="underline">
                      Contact support
                    </Link>
                    {checkout ? ` and quote order ${checkout.publicOrderCode}.` : "."}
                  </p>
                </div>
              ) : phase === "loading" ? (
                <p className="text-center font-bold text-black/60">Loading…</p>
              ) : (
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={startCheckout}
                  disabled={phase === "creating" || phase === "paying" || phase === "verifying" || phase === "processing"}
                >
                  {phase === "creating"
                    ? "Creating order…"
                    : phase === "paying"
                      ? "Opening payment…"
                      : phase === "verifying"
                        ? "Verifying…"
                        : phase === "processing"
                          ? "Processing…"
                          : `Pay ${product ? formatPaise(product.amountPaise) : ""}`}
                </Button>
              )}
            </div>

            <p className="mt-4 text-center text-xs font-bold text-black/50">
              Closing this page during payment is safe — fulfillment continues on
              the server. <Link href="/dashboard" className="underline">Dashboard</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
