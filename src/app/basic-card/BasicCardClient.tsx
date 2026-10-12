"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ticket,
  ShieldCheck,
  Check,
  ChevronRight,
  Building,
  Users,
  Trophy,
  Sparkles,
  Film,
  BookOpen,
  Music,
  Mic,
  Flame,
  Video,
  Radio,
  Gavel,
  Palette,
  Dumbbell,
  Heart,
  Smile,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PillBadge } from "@/components/ui/Badge";
import { formatPaise } from "@/lib/money";
import { ensureRazorpayLoaded } from "@/lib/razorpay-loader";
import { BR_CARD_PERKS } from "@/lib/data";

interface PassProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  amountPaise: number;
  salesState: string;
}

interface ActivePassInfo {
  id: string;
  publicPassCode: string;
  state: string;
  productName: string;
  isBasePass: boolean;
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

/** Shown when a client-side event says the payment failed; it may be wrong. */
const UNCONFIRMED_MESSAGE =
  "We could not confirm the payment. If your bank shows a debit, do not pay again — we are checking the status.";

/** The user closed the Razorpay modal. A UPI collect request may be in flight. */
const DISMISSED_MESSAGE =
  "Payment window closed. If your bank has already debited you, do not pay again — we will confirm it shortly.";

/** A sweeper gave up on the order, but the reconciler still re-checks it. */
const RECOVERING_MESSAGE =
  "We have seen a payment on this order and are confirming it with the bank. Do not pay again — your card will appear here.";

/** Captured money that no automated path can turn into a pass. */
const REVIEW_MESSAGE =
  "Your payment reached us, but we could not issue the card automatically. Our team has been alerted and will resolve it — please do not pay again.";

const RECOMMENDED_EVENTS = [
  { name: "Movie Nighters", icon: Film, cat: "Night Showcase", bg: "bg-blue-200" },
  { name: "Literary Nighters", icon: BookOpen, cat: "Literary & Slam", bg: "bg-amber-200" },
  { name: "Battle of Bands", icon: Music, cat: "Grand Rock Stage", bg: "bg-rose-200" },
  { name: "Rap Battles", icon: Mic, cat: "Underground Hip-Hop", bg: "bg-purple-200" },
  { name: "Street Dance", icon: Flame, cat: "Crew Showdown", bg: "bg-orange-200" },
  { name: "Short Films", icon: Video, cat: "Cinematography", bg: "bg-cyan-200" },
  { name: "Open Mic", icon: Radio, cat: "Acoustics & Comedy", bg: "bg-emerald-200" },
  { name: "JAM", icon: Sparkles, cat: "Just A Minute", bg: "bg-yellow-200" },
  { name: "IPL Auction", icon: Gavel, cat: "Strategy Mock Draft", bg: "bg-lime-200" },
  { name: "Fine Arts Exhibitions", icon: Palette, cat: "Live Gallery", bg: "bg-pink-200" },
  { name: "All Sports Events", icon: Dumbbell, cat: "Gymkhana Arena", bg: "bg-indigo-200" },
];

const FREE_INFORMALS = [
  { name: "Cupid Waltz", desc: "The iconic AIIMS ballroom partner dance", icon: Heart },
  { name: "Musical Chairs", desc: "High-stakes campus madness & spot prizes", icon: Smile },
  { name: "Mr. & Miss PULSE", desc: "The ultimate charisma & personality pageant", icon: Sparkles },
  { name: "Water Balloon Fights", desc: "Midday carnival lawn water showdown", icon: Flame },
];

export default function BasicCardClient({
  isLoggedIn,
  userProfile,
  initialActivePass,
  hasDelegatePass: initialHasDelegatePass = false,
  delegatePassCode: initialDelegatePassCode = null,
}: {
  isLoggedIn: boolean;
  userProfile?: { displayName?: string | null; collegeName?: string | null } | null;
  initialActivePass?: ActivePassInfo | null;
  hasDelegatePass?: boolean;
  delegatePassCode?: string | null;
}) {
  const router = useRouter();
  const [product, setProduct] = useState<PassProduct | null>(null);
  const [activePass, setActivePass] = useState<ActivePassInfo | null>(initialActivePass ?? null);
  const [hasDelegatePass, setHasDelegatePass] = useState<boolean>(initialHasDelegatePass);
  const [delegatePassCode, setDelegatePassCode] = useState<string | null>(initialDelegatePassCode);
  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [phase, setPhase] = useState<
    "loading" | "ready" | "creating" | "paying" | "verifying" | "processing" | "done" | "review" | "error"
  >("loading");
  const [message, setMessage] = useState("");
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the provider has been seen to hold a payment for this order. */
  const paymentSeenRef = useRef(false);

  // Check user active passes
  useEffect(() => {
    if (!isLoggedIn) return;
    (async () => {
      try {
        const res = await fetch("/api/me/passes");
        if (res.ok) {
          const body = await res.json();
          const passes = (body.data?.passes ?? []) as Array<{
            id: string;
            publicPassCode: string;
            state: string;
            productName: string;
            isBasePass?: boolean;
            isDelegatePass?: boolean;
            expiresAt: string | null;
          }>;
          const activeDelegate = passes.find(
            (p) =>
              p.state === "ACTIVE" &&
              (!p.isBasePass ||
                p.isDelegatePass ||
                p.productName?.toLowerCase().includes("delegate") ||
                p.productName?.toLowerCase().includes("all-access") ||
                p.productName?.toLowerCase().includes("vip"))
          );
          if (activeDelegate) {
            setHasDelegatePass(true);
            setDelegatePassCode(activeDelegate.publicPassCode);
          }
          const activeBasic = passes.find(
            (p) =>
              p.state === "ACTIVE" &&
              (p.isBasePass || p.productName?.toLowerCase().includes("basic") || p.productName?.toLowerCase().includes("br"))
          );
          if (activeBasic && !activePass) {
            setActivePass({
              id: activeBasic.id,
              publicPassCode: activeBasic.publicPassCode,
              state: activeBasic.state,
              productName: activeBasic.productName,
              isBasePass: true,
              expiresAt: activeBasic.expiresAt,
            });
          }
        }
      } catch {
        // ignore
      }
    })();
  }, [isLoggedIn, activePass]);

  // Load pass products
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/public/pass-products");
        const body = await res.json();
        if (!body.ok) throw new Error("Could not load pass products");
        const products = body.data.products as PassProduct[];
        // Find the basic pass
        const basic =
          products.find(
            (p) =>
              p.slug === "base-delegate-pass" ||
              p.amountPaise === 20000 ||
              p.name.toLowerCase().includes("basic")
          ) ?? products[0];

        setProduct(basic ?? null);
        setPhase(basic ? "ready" : "error");
        if (!basic) setMessage("Basic Card sales are currently unavailable.");
      } catch (err) {
        setPhase("error");
        setMessage(err instanceof Error ? err.message : "Could not load pass details");
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
            setMessage("Payment confirmed! Your Basic Festival Card is active.");
            // Refresh passes
            const passRes = await fetch("/api/me/passes");
            const passBody = await passRes.json();
            if (passBody.ok && passBody.data.passes?.length > 0) {
              const p = passBody.data.passes.find(
                (pass: { isBasePass?: boolean; productName?: string }) =>
                  pass.isBasePass || pass.productName?.toLowerCase().includes("basic")
              ) ?? passBody.data.passes[0];
              setActivePass({
                id: p.id,
                publicPassCode: p.publicPassCode,
                state: p.state,
                productName: p.productName,
                isBasePass: true,
                expiresAt: p.expiresAt,
              });
            }
            return;
          }

          // Money we hold that no automated path can turn into a card. This is
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
        description: "Basic Festival Entry Card",
        prefill: {
          name: userProfile?.displayName ?? "",
        },
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
            setMessage("Verifying and issuing your Basic Festival Card…");
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
      router.push("/login?next=/basic-card");
      return;
    }
    if (hasDelegatePass) {
      setMessage("You already hold an active VIP Delegate Card with full festival access.");
      return;
    }
    if (activePass) {
      setMessage("You already have an active Basic Card!");
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
        setMessage("You already have an active Basic Card!");
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

  const formattedPrice = product ? formatPaise(product.amountPaise) : "₹200";

  return (
    <div className="min-h-screen bg-neo-cream pb-24">
      {/* Hero Header */}
      <section className="relative overflow-hidden border-b-8 border-black bg-black py-16 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(#ff6b6b_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <PillBadge variant="accent" className="text-black font-black">
                <Ticket className="h-4 w-4" />
                OFFICIAL PARTICIPANT CARD
              </PillBadge>
              <PillBadge variant="secondary" className="text-black font-black">
                {formattedPrice} · 5-Day Access
              </PillBadge>
            </div>
            <Link
              href="/delegate-pass"
              className="inline-flex items-center gap-1.5 text-xs font-black uppercase text-white/80 hover:text-neo-secondary underline"
            >
              <span>Need Pro Show Concert Access? Get Delegate Card</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-8 max-w-3xl">
            <span className="text-xs font-black uppercase tracking-[0.25em] text-neo-secondary">
              PULSE 2026 · AIIMS New Delhi
            </span>
            <h1 className="mt-2 text-5xl font-black uppercase leading-[0.9] tracking-tighter sm:text-6xl md:text-7xl">
              PULSE <span className="text-neo-accent">BR Card</span>
            </h1>
            <p className="mt-4 text-lg font-bold text-white/85 sm:text-xl leading-relaxed">
              Your key to South Asia’s largest medical fest. Mandatory for campus entry and participating in all competitions across 5 electric days.
            </p>
          </div>
        </div>
      </section>

      {/* Mandatory Notice Strip */}
      <section className="border-b-4 border-black bg-neo-secondary py-4 text-black">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex items-start sm:items-center gap-3">
            <AlertCircle className="h-6 w-6 shrink-0 text-black mt-0.5 sm:mt-0" strokeWidth={2.5} />
            <p className="text-sm font-black leading-snug">
              <strong>MANDATORY PARTICIPANT NOTICE: </strong>
              {BR_CARD_PERKS.mandatoryNotice}
            </p>
          </div>
        </div>
      </section>

      {/* Main Grid */}
      <div className="mx-auto max-w-7xl px-4 pt-12 sm:px-6">
        <div className="grid gap-12 lg:grid-cols-12">
          {/* Left Column: Perks & Events Showcase */}
          <div className="space-y-12 lg:col-span-7">
            {/* Section 1: Recommended Events Showcase */}
            <div>
              <div className="border-b-4 border-black pb-4">
                <div className="inline-flex items-center gap-2 border-2 border-black bg-neo-accent px-3 py-1 text-xs font-black uppercase tracking-wider">
                  <Sparkles className="h-4 w-4" />
                  Live The Experience
                </div>
                <h2 className="mt-3 text-3xl font-black uppercase tracking-tight sm:text-4xl">
                  Recommended Festival Events
                </h2>
                <p className="mt-2 text-sm font-bold text-black/75 leading-relaxed">
                  Your BR Card gives you access to the AIIMS campus throughout PULSE and lets you live the experience of all competitions and showcases:
                </p>
              </div>

              {/* Recommended Events Grid */}
              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {RECOMMENDED_EVENTS.map((event, idx) => {
                  const Icon = event.icon;
                  return (
                    <div
                      key={idx}
                      className={`flex items-center justify-between border-4 border-black p-4 shadow-neo-sm transition-transform hover:-translate-y-1 ${event.bg}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-black bg-white shadow-neo-xs">
                          <Icon className="h-5 w-5 text-black" strokeWidth={2.5} />
                        </div>
                        <div>
                          <h4 className="text-base font-black uppercase leading-tight text-black">
                            {event.name}
                          </h4>
                          <span className="text-[11px] font-bold text-black/70">
                            {event.cat}
                          </span>
                        </div>
                      </div>
                      <span className="border border-black bg-white px-2 py-0.5 text-[10px] font-black uppercase text-black">
                        Spectate
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Heart & Soul Message Box */}
              <div className="mt-6 border-4 border-black bg-white p-5 shadow-neo">
                <p className="text-sm font-bold leading-relaxed text-black/90">
                  {BR_CARD_PERKS.leadParagraph}
                </p>
              </div>
            </div>

            {/* Section 2: Free Informal Events Unlocked */}
            <div>
              <div className="border-b-4 border-black pb-4">
                <div className="inline-flex items-center gap-2 border-2 border-black bg-neo-secondary px-3 py-1 text-xs font-black uppercase tracking-wider">
                  <Smile className="h-4 w-4" />
                  100% Free With BR Card
                </div>
                <h2 className="mt-3 text-3xl font-black uppercase tracking-tight sm:text-4xl">
                  Unlocked Free Informal Events
                </h2>
                <p className="mt-2 text-sm font-bold text-black/75">
                  But that’s not all. Your BR Card unlocks a host of completely free informal carnival events:
                </p>
              </div>

              <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {FREE_INFORMALS.map((informal, idx) => {
                  const Icon = informal.icon;
                  return (
                    <div
                      key={idx}
                      className="border-4 border-black bg-white p-5 shadow-neo transition-transform hover:-translate-y-1"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-black bg-neo-secondary shadow-neo-xs">
                          <Icon className="h-6 w-6 text-black" strokeWidth={2.5} />
                        </div>
                        <div>
                          <h4 className="text-lg font-black uppercase leading-tight text-black">
                            {informal.name}
                          </h4>
                          <span className="inline-block border border-black bg-green-200 px-1.5 py-0.2 text-[9px] font-black uppercase text-green-900">
                            Free Entry
                          </span>
                        </div>
                      </div>
                      <p className="mt-3 text-xs font-bold text-black/75 leading-relaxed">
                        {informal.desc}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Tagline Callout Banner */}
            <div className="border-8 border-black bg-neo-accent p-8 text-center shadow-neo-lg">
              <h3 className="text-3xl font-black uppercase tracking-tight text-black sm:text-4xl">
                {BR_CARD_PERKS.tagline}
              </h3>
              <p className="mx-auto mt-2 max-w-lg text-sm font-bold text-black/85">
                Join thousands of students and delegates from 450+ colleges across India at AIIMS New Delhi.
              </p>
            </div>
          </div>

          {/* Right Column: Sticky Checkout & Card Preview */}
          <div className="lg:col-span-5">
            <div className="sticky top-24 border-8 border-black bg-white p-8 shadow-neo-xl">
              <div className="flex items-center justify-between border-b-4 border-black pb-4">
                <div>
                  <span className="text-[11px] font-black uppercase tracking-widest text-black/60">
                    Official Participant Pass
                  </span>
                  <h2 className="text-3xl font-black uppercase tracking-tight">
                    PULSE BR Card
                  </h2>
                </div>
                <div className="text-right">
                  <span className="text-3xl font-black text-black">
                    {formattedPrice}
                  </span>
                  <p className="text-[10px] font-bold uppercase text-black/60">
                    5-Day Access
                  </p>
                </div>
              </div>

              {/* Inclusions Checklist */}
              <div className="mt-6 space-y-3">
                <div className="flex items-start gap-2.5 text-xs font-bold text-black">
                  <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" strokeWidth={3} />
                  <span>Mandatory 5-Day campus access to AIIMS New Delhi</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs font-bold text-black">
                  <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" strokeWidth={3} />
                  <span>Eligible for all 250+ competitions across dance, music, arts &amp; sports</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs font-bold text-black">
                  <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" strokeWidth={3} />
                  <span>Free entry to informal events (Cupid Waltz, Mr/Miss PULSE, etc.)</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs font-bold text-black">
                  <Check className="h-4 w-4 text-green-600 shrink-0 mt-0.5" strokeWidth={3} />
                  <span>Unique String gate verification code in dashboard</span>
                </div>
                <div className="flex items-start gap-2.5 text-xs font-bold text-black/70">
                  <Check className="h-4 w-4 text-black/50 shrink-0 mt-0.5" strokeWidth={3} />
                  <span>Valid for all festival days (17–21 September 2026)</span>
                </div>
              </div>

              {/* Delegate Pass note */}
              <div className="mt-5 border-2 border-black/20 bg-neo-cream p-3 text-xs font-bold text-black/80">
                <span className="font-black text-black uppercase">Note: </span>
                For Star Nights / Prime Concerts, you will need the All-Access Delegate Card.
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

              {/* Purchase Action Button */}
              <div className="mt-8">
                {hasDelegatePass ? (
                  <div className="space-y-3">
                    <div className="border-4 border-black bg-neo-secondary p-4 text-black shadow-neo-sm">
                      <p className="text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 fill-black" />
                        VIP Delegate Card Active!
                      </p>
                      <p className="mt-1 text-xs font-bold text-black/90 leading-snug">
                        Your account already holds an All-Access VIP Delegate Card {delegatePassCode ? `(${delegatePassCode})` : ""}. You already have full 5-day campus access, star pro shows, and competition eligibility. You do not need to buy a Basic Card!
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={() => router.push("/dashboard")}
                    >
                      View Card in Dashboard <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                ) : activePass ? (
                  <div className="space-y-3">
                    <p className="border-2 border-black bg-green-200 p-3 text-center text-xs font-black uppercase">
                      ✓ You have an active BR Card! ({activePass.publicPassCode})
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
                    onClick={() => router.push("/login?next=/basic-card")}
                  >
                    Sign In to Buy BR Card ({formattedPrice})
                  </Button>
                ) : phase === "review" ? (
                  <div className="space-y-2">
                    <Button
                      variant="secondary"
                      className="w-full"
                      onClick={() => router.push("/dashboard")}
                    >
                      Go to Dashboard →
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
                    Go to Dashboard →
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
                            : `Get BR Card — ${formattedPrice}`}
                  </Button>
                )}
              </div>

              <div className="mt-6 border-t-2 border-black/10 pt-4 text-center text-xs font-bold text-black/60">
                <p>🔒 256-Bit SSL Encrypted Razorpay Checkout</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

