"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Sparkles,
  Check,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PillBadge } from "@/components/ui/Badge";
import { formatPaise } from "@/lib/money";
import ConcertPassCard from "@/components/cards/ConcertPassCard";
import { ensureRazorpayLoaded } from "@/lib/razorpay-loader";

interface PassProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  amountPaise: number;
  salesState: string;
  isBasePass?: boolean;
}

interface ActivePassInfo {
  id: string;
  publicPassCode: string;
  state: string;
  productName: string;
  isDelegatePass: boolean;
  expiresAt: string | null;
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

/**
 * Payment messaging rules (see also src/app/basic-card/BasicCardClient.tsx and
 * src/app/checkout/CheckoutFlow.tsx).
 *
 * Nothing here may assert that money did not move. The SDK's client-side
 * failure events are hints, not settlement — a delayed debit, an authorization
 * without capture, or a reversal all produce them. So a failure says "we could
 * not confirm", keeps polling, and offers a retry that reuses the SAME
 * idempotency key: the retry lands on the same Razorpay order, which the
 * provider will not let the user pay twice. The key is regenerated in exactly
 * one place — an order the provider never saw a payment for.
 */

/** Shown when a client-side event says the payment failed; it may be wrong. */
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

const PRIME_EVENTS = [
  { name: "Music Nights", tag: "Concert", icon: "🎵" },
  { name: "DJ / EDM Night", tag: "Pro Show", icon: "🎧" },
  { name: "Fash Show", tag: "Runway", icon: "✨" },
  { name: "Classical Night", tag: "Live", icon: "🎻" },
  { name: "Cultural Night", tag: "Main Stage", icon: "🎭" },
  { name: "Band Night", tag: "Rock Arena", icon: "🎸" },
  { name: "P Wave", tag: "Headline", icon: "🌊" },
];

const FREE_INFORMAL_EVENTS = [
  { name: "PlayStation", tag: "Gaming Hub", icon: "🎮" },
  { name: "Speed Dating", tag: "Interactive", icon: "💖" },
  { name: "Hogathon", tag: "Food Battle", icon: "🍔" },
  { name: "Virtual Reality", tag: "VR Arena", icon: "🥽" },
  { name: "Treasure Hunt", tag: "Campus-Wide", icon: "🗺️" },
  { name: "(And Many More Informal Events)", tag: "Open Entry", icon: "🎪" },
];

export default function DelegatePassClient({
  isLoggedIn,
  userProfile,
  initialActivePass,
  hasDelegatePass: initialHasDelegatePass = false,
}: {
  isLoggedIn: boolean;
  userProfile?: { displayName?: string | null; collegeName?: string | null } | null;
  initialActivePass?: ActivePassInfo | null;
  hasDelegatePass?: boolean;
}) {
  const router = useRouter();
  const [product, setProduct] = useState<PassProduct | null>(null);
  const [basicProduct, setBasicProduct] = useState<PassProduct | null>(null);
  const [activePass, setActivePass] = useState<ActivePassInfo | null>(initialActivePass ?? null);
  const [hasDelegatePass, setHasDelegatePass] = useState<boolean>(initialHasDelegatePass);
  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [phase, setPhase] = useState<
    | "loading"
    | "ready"
    | "creating"
    | "paying"
    | "verifying"
    | "processing"
    | "done"
    | "review"
    | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the provider has been seen to hold a payment for this order. */
  const paymentSeenRef = useRef(false);

  // Load pass products
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/public/pass-products");
        const body = await res.json();
        if (!body.ok) throw new Error("Could not load pass products");
        const products = body.data.products as PassProduct[];
        // Find the VIP Delegate Pass
        const delegate =
          products.find(
            (p) =>
              p.slug === "vip-delegate-pass" ||
              p.isBasePass === false ||
              p.amountPaise === 200000 ||
              p.name.toLowerCase().includes("all-access") ||
              p.name.toLowerCase().includes("delegate")
          ) ?? products[0];

        const basic =
          products.find(
            (p) =>
              p.slug === "base-delegate-pass" ||
              p.isBasePass === true ||
              p.name.toLowerCase().includes("basic")
          ) ?? null;

        setProduct(delegate ?? null);
        setBasicProduct(basic);
        setPhase(delegate ? "ready" : "error");
        if (!delegate) setMessage("Delegate card sales are currently unavailable.");
      } catch (err) {
        setPhase("error");
        setMessage(err instanceof Error ? err.message : "Could not load card details");
      }
    })();
  }, []);

  // Load Razorpay SDK
  useEffect(() => {
    if (document.getElementById("razorpay-sdk")) return;
    const script = document.createElement("script");
    script.id = "razorpay-sdk";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const pollRef = useRef<((orderId: string, attempt?: number) => Promise<void>) | null>(null);

  const pollOrderStatus = useCallback(
    async (orderId: string, attempt = 0) => {
      if (attempt > 12) {
        setPhase("processing");
        setMessage(
          paymentSeenRef.current
            ? RECOVERING_MESSAGE
            : "Still processing payment. Safe to check your dashboard in a moment."
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
            setHasDelegatePass(true);
            setMessage("Payment confirmed! Your VIP All-Access Delegate Card is active.");
            // Refresh passes
            const passRes = await fetch("/api/me/passes");
            const passBody = await passRes.json();
            if (passBody.ok && passBody.data.passes?.length > 0) {
              const p = passBody.data.passes.find(
                (pass: { isBasePass?: boolean; productName?: string }) =>
                  !pass.isBasePass && !pass.productName?.toLowerCase().includes("basic")
              ) ?? passBody.data.passes[0];
              setActivePass({
                id: p.id,
                publicPassCode: p.publicPassCode,
                state: p.state,
                productName: p.productName,
                isDelegatePass: true,
                expiresAt: p.expiresAt,
              });
            }
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
              setMessage("Order expired or cancelled. Please try again.");
              idempotencyKeyRef.current = newIdempotencyKey();
              return;
            }
          }
        }
      } catch {
        // Transient
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
        setMessage("Payment gateway SDK failed to load. Please check your connection and retry.");
        return;
      }
      const rzp = new RazorpayCtor({
        key: data.razorpayKeyId,
        order_id: data.razorpayOrderId,
        amount: data.amountPaise,
        currency: data.currency,
        name: "PULSE 2026",
        description: "VIP All-Access Delegate Card",
        prefill: {
          name: userProfile?.displayName ?? "",
        },
        theme: { color: "#ffde59" },
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
            setMessage("Verifying and issuing your VIP Concert Card…");
            pollOrderStatus(data.localOrderId);
          } catch (err) {
            setPhase("processing");
            setMessage(
              err instanceof Error
                ? `${err.message} — confirming payment state…`
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
    [pollOrderStatus, userProfile]
  );

  const startCheckout = useCallback(async () => {
    if (!isLoggedIn) {
      router.push("/login?next=/delegate-card");
      return;
    }
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
        setMessage("You already have an active VIP card!");
        return;
      }

      if (data.amountPaise === 0) {
        pollOrderStatus(data.localOrderId);
        setPhase("processing");
        return;
      }

      if (!data.razorpayOrderId || !data.razorpayKeyId) {
        setPhase("processing");
        setMessage("Preparing payment gateway…");
        pollOrderStatus(data.localOrderId);
        return;
      }

      openRazorpay(data);
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Checkout failed");
    }
  }, [isLoggedIn, product, pollOrderStatus, openRazorpay, router]);

  const formattedPrice = product ? formatPaise(product.amountPaise) : "₹2,000";
  const basicPriceFormatted = basicProduct ? formatPaise(basicProduct.amountPaise) : "₹200";

  return (
    <div className="min-h-screen bg-neo-cream pb-20">
      {/* Hero Header */}
      <section className="relative overflow-hidden border-b-8 border-black bg-black py-16 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(#ffde59_1px,transparent_1px)] [background-size:24px_24px] opacity-15" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <PillBadge variant="secondary" className="text-black font-black">
                <Sparkles className="h-4 w-4 fill-black" />
                VIP ALL-ACCESS CARD
              </PillBadge>
              <PillBadge variant="accent" className="text-black font-black">
                {formattedPrice}
              </PillBadge>
            </div>
            <Link
              href="/basic-card"
              className="text-xs font-black uppercase text-white/70 hover:text-neo-secondary underline"
            >
              Looking for Basic Card ({basicPriceFormatted})? Click here →
            </Link>
          </div>

          <div className="mt-8 max-w-3xl">
            <h1 className="text-5xl font-black uppercase leading-[0.9] tracking-tighter sm:text-6xl md:text-7xl">
              All-Access <span className="text-neo-secondary">Delegate Card</span> &amp; Concert Card
            </h1>
            <p className="mt-4 text-lg font-bold text-white/80 sm:text-xl">
              Experience the pinnacle of PULSE 2026. Full 5-day festival access, all star pro shows,
              front-row VIP concert arena, and exclusive backstage perks.
            </p>
          </div>
        </div>
      </section>

      {/* Active Card Section (If Already Purchased) */}
      {activePass && (
        <section className="mx-auto max-w-5xl px-4 pt-8 sm:px-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-2xl font-black uppercase tracking-tight">
              Your Purchased Delegate Card
            </h2>
            <Link
              href="/dashboard"
              className="text-sm font-black uppercase underline hover:text-neo-accent"
            >
              Go to Dashboard →
            </Link>
          </div>

          <ConcertPassCard
            passId={activePass.id}
            passCode={activePass.publicPassCode}
            state={activePass.state}
            productName={activePass.productName || "VIP All-Access Delegate Card"}
            priceLabel={formattedPrice}
            userName={userProfile?.displayName}
            collegeName={userProfile?.collegeName}
            expiresAt={activePass.expiresAt}
          />
        </section>
      )}

      {/* Main Content: Left = Perks (Del Kit Showcase), Right = Checkout & Card Box */}
      <div className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-12 items-start">
          
          {/* Left Column: Official Perks Showcase (7 Cols) */}
          <div className="space-y-6 lg:col-span-7">
            <div className="border-8 border-black bg-[#121214] text-white p-6 sm:p-8 shadow-neo-xl relative overflow-hidden">
              {/* Halftone grid & glow effects */}
              <div className="bg-grid-white absolute inset-0 opacity-10" aria-hidden />
              <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-neo-accent/20 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-neo-secondary/20 blur-3xl pointer-events-none" />

              {/* Header Stamp & Title */}
              <div className="relative z-10 text-center pb-6 border-b-4 border-white/20">
                <div className="inline-flex items-center gap-2 border-2 border-black bg-neo-accent px-3 py-1 text-black font-black uppercase text-xs tracking-widest shadow-neo-xs rotate-[-1deg] mb-3">
                  <Sparkles className="h-4 w-4 fill-black" />
                  DEL KIT · OFFICIAL ENTITLEMENTS
                </div>
                <h2 className="text-4xl sm:text-5xl font-black uppercase tracking-tight text-neo-secondary">
                  PERKS
                </h2>
                <p className="mt-1 text-xs sm:text-sm font-bold text-zinc-300">
                  Included exclusively with your VIP All-Access Delegate Card
                </p>
              </div>

              {/* Two Perk Categories (All Prime Events vs Free Events) */}
              <div className="relative z-10 mt-6 grid gap-6 sm:grid-cols-2">
                {/* Column 1: All Prime Events */}
                <div className="border-4 border-neo-accent/60 bg-black/70 p-4 sm:p-5 shadow-inner">
                  <div className="flex items-center gap-2 border-b-2 border-neo-accent/40 pb-3 mb-4">
                    <span className="text-xl">⭐</span>
                    <h3 className="text-base sm:text-lg font-black uppercase tracking-tight text-neo-accent">
                      ALL PRIME EVENTS
                    </h3>
                  </div>
                  <ul className="space-y-2.5">
                    {PRIME_EVENTS.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-center justify-between border-2 border-white/15 bg-white/5 px-3 py-2 text-xs sm:text-sm font-black uppercase tracking-wide text-white hover:border-neo-accent hover:bg-neo-accent/10 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <span>{item.icon}</span>
                          <span>{item.name}</span>
                        </span>
                        <span className="text-[10px] font-mono border border-neo-accent/40 bg-neo-accent/20 text-neo-accent px-1.5 py-0.5">
                          {item.tag}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Column 2: Free Events */}
                <div className="border-4 border-neo-secondary/60 bg-black/70 p-4 sm:p-5 shadow-inner">
                  <div className="flex items-center gap-2 border-b-2 border-neo-secondary/40 pb-3 mb-4">
                    <span className="text-xl">🎪</span>
                    <h3 className="text-base sm:text-lg font-black uppercase tracking-tight text-neo-secondary">
                      FREE EVENTS
                    </h3>
                  </div>
                  <ul className="space-y-2.5">
                    {FREE_INFORMAL_EVENTS.map((item, idx) => (
                      <li
                        key={idx}
                        className="flex items-center justify-between border-2 border-white/15 bg-white/5 px-3 py-2 text-xs sm:text-sm font-black uppercase tracking-wide text-white hover:border-neo-secondary hover:bg-neo-secondary/10 transition-colors"
                      >
                        <span className="flex items-center gap-2">
                          <span>{item.icon}</span>
                          <span>{item.name}</span>
                        </span>
                        <span className="text-[10px] font-mono border border-neo-secondary/40 bg-neo-secondary/20 text-neo-secondary px-1.5 py-0.5">
                          {item.tag}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Poster Right of Entry Footnote */}
              <div className="relative z-10 mt-6 border-t-2 border-white/20 pt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] font-black uppercase tracking-widest text-zinc-400">
                <span>*RIGHT OF ENTRY RESERVED</span>
                <span className="text-neo-secondary">PULSE 2026 · AIIMS NEW DELHI</span>
              </div>
            </div>
          </div>

          {/* Right Column: Checkout & Purchase Action (5 Cols) */}
          <div className="lg:col-span-5">
            <div className="sticky top-24 border-8 border-black bg-white p-6 sm:p-8 shadow-neo-xl">
              <div className="flex items-center justify-between border-b-4 border-black pb-4">
                <div>
                  <span className="text-[11px] font-black uppercase tracking-widest text-black/60">
                    Official Festival Card
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">
                    VIP Delegate Card
                  </h2>
                </div>
                <div className="text-right">
                  <span className="text-3xl sm:text-4xl font-black text-black">
                    {formattedPrice}
                  </span>
                  <p className="text-[10px] font-bold uppercase text-black/60">
                    All 5 Days Included
                  </p>
                </div>
              </div>

              {/* Status summary */}
              <div className="mt-6 space-y-3">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
                  <Check className="h-4 w-4 text-green-600 shrink-0" strokeWidth={3} />
                  <span>Includes all 7 Prime Events &amp; Star Concert Nights</span>
                </div>
                <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
                  <Check className="h-4 w-4 text-green-600 shrink-0" strokeWidth={3} />
                  <span>Free access to PlayStation, VR &amp; all Informal Zones</span>
                </div>
                <div className="flex items-center gap-2 text-xs sm:text-sm font-bold">
                  <Check className="h-4 w-4 text-green-600 shrink-0" strokeWidth={3} />
                  <span>Dynamic QR code generated for instant gate scanning</span>
                </div>
              </div>

              {checkout && phase !== "ready" && (
                <p className="mt-4 text-xs font-mono font-bold uppercase text-black/60">
                  Order Code: {checkout.publicOrderCode}
                </p>
              )}

              {message && (
                <div
                  className={`mt-4 border-4 border-black p-3 text-xs font-bold ${
                    phase === "error"
                      ? "bg-neo-accent text-black"
                      : phase === "done"
                        ? "bg-green-300 text-black"
                        : phase === "review"
                          ? "bg-neo-cream text-black"
                          : "bg-neo-secondary text-black"
                  }`}
                  role="status"
                >
                  {message}
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-8">
                {hasDelegatePass ? (
                  <div className="space-y-3">
                    <p className="border-2 border-black bg-green-300 p-3 text-center text-xs font-black uppercase">
                      ✓ VIP All-Access Delegate Card Active!
                    </p>
                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={() => router.push("/dashboard")}
                    >
                      View in Dashboard <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                ) : !isLoggedIn ? (
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => router.push("/login?next=/delegate-card")}
                  >
                    Sign In to Buy Delegate Card ({formattedPrice}) <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : phase === "review" ? (
                  // Deliberately no pay button: we already hold this user's money.
                  <div className="space-y-2">
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={() => router.push("/dashboard")}
                    >
                      Go to My Dashboard →
                    </Button>
                    <p className="text-center text-xs font-bold text-black/60">
                      Need it sooner?{" "}
                      <Link href="/ask" className="underline">
                        Contact support
                      </Link>
                      {checkout ? ` and quote order ${checkout.publicOrderCode}.` : "."}
                    </p>
                  </div>
                ) : phase === "done" ? (
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => router.push("/dashboard")}
                  >
                    Go to My Dashboard →
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={startCheckout}
                    disabled={
                      phase === "creating" ||
                      phase === "paying" ||
                      phase === "verifying" ||
                      phase === "processing"
                    }
                  >
                    {phase === "creating"
                      ? "Creating Order…"
                      : phase === "paying"
                        ? "Opening Payment Gateway…"
                        : phase === "verifying"
                          ? "Verifying Payment…"
                          : phase === "processing"
                            ? "Processing Card Issuance…"
                            : `Pay ${formattedPrice}`}
                  </Button>
                )}
              </div>

              <div className="mt-6 border-t-2 border-black/10 pt-4 text-center text-xs font-bold text-black/60">
                <p>🔒 256-Bit SSL Encrypted Razorpay Checkout</p>
                <p className="mt-1">
                  Immediate card generation and QR code delivery upon payment confirmation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
