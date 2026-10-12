"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, QrCode } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";
import PassTicket from "@/components/tarang/PassTicket";
import { Reveal } from "@/components/tarang/Reveal";
import { FEST } from "@/lib/data";
import { formatPaise } from "@/lib/money";
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

export interface ActivePassInfo {
  id: string;
  publicPassCode: string;
  state: string;
  productName: string;
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
  "We have seen a payment on this order and are confirming it with the bank. Do not pay again — your pass will appear here.";

/** Captured money that no automated path can turn into a pass. */
const REVIEW_MESSAGE =
  "Your payment reached us, but we could not issue the pass automatically. Our team has been alerted and will resolve it — please do not pay again.";

const PERKS = [
  { title: "Every pronite", body: "Entry to all five headline nights on the main stage." },
  { title: "Campus access", body: `In and out of ${FEST.college} across all festival days.` },
  { title: "Every competition", body: "Unlocks registration for solo and team events." },
  { title: "One QR", body: "Your gate QR lives in your dashboard — no paper, no queue." },
];

type Phase = "loading" | "ready" | "creating" | "paying" | "verifying" | "processing" | "done" | "review" | "error";

/** The single TARANG pass: the ticket, what it gets you, and checkout. */
export default function PronitePassClient({
  isLoggedIn,
  userProfile,
  initialActivePass,
}: {
  isLoggedIn: boolean;
  userProfile?: { displayName?: string | null; collegeName?: string | null } | null;
  initialActivePass?: ActivePassInfo | null;
}) {
  const router = useRouter();
  const [product, setProduct] = useState<PassProduct | null>(null);
  const [activePass, setActivePass] = useState<ActivePassInfo | null>(initialActivePass ?? null);
  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [message, setMessage] = useState("");
  const idempotencyKeyRef = useRef<string>(newIdempotencyKey());
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Whether the provider has been seen to hold a payment for this order. */
  const paymentSeenRef = useRef(false);

  // Pick up a pass bought in another tab.
  useEffect(() => {
    if (!isLoggedIn || activePass) return;
    (async () => {
      try {
        const res = await fetch("/api/me/passes");
        if (!res.ok) return;
        const body = await res.json();
        const passes = (body.data?.passes ?? []) as Array<ActivePassInfo>;
        const active = passes.find((p) => p.state === "ACTIVE");
        if (active) setActivePass(active);
      } catch {
        // ignore
      }
    })();
  }, [isLoggedIn, activePass]);

  // Load the pass product. There is one pass on sale: the base pass product.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/public/pass-products");
        const body = await res.json();
        if (!body.ok) throw new Error("Could not load the pass");
        const products = body.data.products as PassProduct[];
        const pass = products.find((p) => p.isBasePass) ?? products[0];
        setProduct(pass ?? null);
        setPhase(pass ? "ready" : "error");
        if (!pass) setMessage("Pronite Pass sales are not open yet.");
      } catch (err) {
        setPhase("error");
        setMessage(err instanceof Error ? err.message : "Could not load pass details");
      }
    })();
  }, []);

  const pollRef = useRef<((orderId: string, attempt?: number) => Promise<void>) | null>(null);

  const pollOrderStatus = useCallback(async (orderId: string, attempt = 0) => {
    if (attempt > 12) {
      setPhase("processing");
      setMessage(
        paymentSeenRef.current ? RECOVERING_MESSAGE : "Still processing payment. Safe to check your dashboard in a moment."
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
          setMessage("Payment confirmed — your Pronite Pass is live.");
          const passRes = await fetch("/api/me/passes");
          const passBody = await passRes.json();
          const p = (passBody.data?.passes as ActivePassInfo[] | undefined)?.find((x) => x.state === "ACTIVE");
          if (p) setActivePass(p);
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
  }, []);

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
        setMessage("Payment gateway failed to load. Please check your connection and retry.");
        return;
      }
      const rzp = new RazorpayCtor({
        key: data.razorpayKeyId,
        order_id: data.razorpayOrderId,
        amount: data.amountPaise,
        currency: data.currency,
        name: `TARANG ${FEST.year}`,
        description: "Pronite Pass",
        prefill: { name: userProfile?.displayName ?? "" },
        theme: { color: "#d4190f" },
        handler: async (response: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) => {
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
            if (!res.ok || !body.ok) throw new Error(body.message ?? "Verification failed");
            setPhase("processing");
            setMessage("Verifying payment and issuing your pass…");
            pollOrderStatus(data.localOrderId);
          } catch (err) {
            setPhase("processing");
            setMessage(err instanceof Error ? `${err.message} — confirming payment state…` : "Checking payment status…");
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
      router.push("/login?next=/pronite-pass");
      return;
    }
    if (activePass) {
      setMessage("You already hold an active Pronite Pass.");
      return;
    }
    if (!product) return;
    setPhase("creating");
    setMessage("");
    try {
      const res = await fetch("/api/checkout/base-pass", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKeyRef.current },
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
        setMessage("You already hold an active Pronite Pass.");
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
  }, [isLoggedIn, activePass, product, pollOrderStatus, openRazorpay, router]);

  const price = product ? formatPaise(product.amountPaise) : "—";
  const busy = phase === "creating" || phase === "paying" || phase === "verifying" || phase === "processing";

  return (
    <div className="pb-24">
      {/* Masthead */}
      <section className="t-halftone relative isolate overflow-hidden border-b-[3px] border-ink">
        <div aria-hidden className="kit-hands pointer-events-none absolute -right-[18vw] -top-[8%] w-[min(92vw,680px)] md:-right-[4vw] md:-top-[28%]">
          <Image src="/tarang/hands-top.webp" alt="" width={1407} height={833} loading="eager" sizes="(max-width: 768px) 92vw, 680px" className="h-auto w-full rotate-[-8deg]" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 pb-14 pt-28 sm:px-6 md:pb-20 md:pt-36">
          <p className="t-label kit-fade flex items-center gap-3 text-bone/85">
            <span className="inline-block h-2 w-2 rounded-full bg-signal [animation:t-blink_1.2s_steps(1)_infinite]" />
            One pass · every night
          </p>
          <h1 className="t-display mt-6 text-[clamp(3.4rem,10vw,9rem)] leading-[0.86]">
            <span className="kit-drop-mask">
              <span className="kit-drop t-cut">Pronite</span>
            </span>{" "}
            <span className="kit-drop-mask">
              <span className="kit-drop text-bone [text-shadow:5px_5px_0_var(--color-ink)]" style={{ animationDelay: "560ms" }}>
                Pass
              </span>
            </span>
          </h1>
          <p className="kit-fade mt-6 max-w-xl text-lg leading-relaxed text-bone/85 md:text-xl" style={{ animationDelay: "500ms" }}>
            Five nights on the main stage at {FEST.college}, campus access for the whole fest, and every competition — on a
            single ticket.
          </p>
        </div>
      </section>

      {/* The ticket */}
      <section className="relative mx-auto max-w-6xl px-4 pt-14 sm:px-6 md:pt-20">
        <Reveal variant="stamp" rotate={-1.2}>
          <PassTicket price={price} serial={activePass?.publicPassCode ?? "No. 0026 — PRN"} />
        </Reveal>
      </section>

      {/* What it gets you + checkout */}
      <section className="mx-auto mt-16 grid max-w-6xl gap-10 px-4 sm:px-6 md:mt-24 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <p className="t-label flex items-center gap-3 text-bone/55">
            <span className="inline-block h-px w-8 bg-signal" />
            What it gets you
          </p>
          <ol className="mt-8 grid gap-px overflow-hidden rounded-[6px] border-[3px] border-black bg-bone/15 sm:grid-cols-2">
            {PERKS.map((perk, i) => (
              <Reveal as="li" key={perk.title} delay={i * 90} className="bg-ink p-6 md:p-8">
                <span className="t-display text-5xl leading-none text-transparent [-webkit-text-stroke:1.5px_var(--color-signal)]">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h2 className="t-display mt-5 text-2xl text-bone">{perk.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-bone/65">{perk.body}</p>
              </Reveal>
            ))}
          </ol>
        </div>

        <div className="lg:col-span-5">
          <div className="kit-rise sticky top-24 rounded-[6px] border-[3px] border-black bg-neo-card p-6 shadow-neo-lg md:p-8">
            <div className="flex items-end justify-between gap-4 border-b border-bone/15 pb-5">
              <div>
                <p className="t-label text-bone/55">Pronite Pass</p>
                <p className="t-display mt-2 text-3xl text-bone">All nights</p>
              </div>
              <p className="t-display text-5xl text-signal">{price}</p>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-bone/65">
              {FEST.dates} · {FEST.venueShort}
            </p>

            {checkout && phase !== "ready" && (
              <p className="t-label mt-4 text-bone/55">Order {checkout.publicOrderCode}</p>
            )}

            {message && (
              <div
                role="status"
                className={`mt-5 rounded-[4px] border-2 p-3 text-sm leading-snug ${
                  phase === "error"
                    ? "border-signal bg-signal/10 text-bone"
                    : phase === "done"
                      ? "border-emerald-400/60 bg-emerald-400/10 text-bone"
                      : "border-bone/30 bg-bone/5 text-bone/85"
                }`}
              >
                {message}
              </div>
            )}

            <div className="mt-7">
              {activePass ? (
                <div className="space-y-3">
                  <p className="rounded-[4px] border-2 border-emerald-400/60 bg-emerald-400/10 p-3 text-center text-sm text-bone">
                    You’re in — pass <span className="font-[family-name:var(--font-mono)]">{activePass.publicPassCode}</span>
                  </p>
                  <ButtonLink href={`/dashboard/pass/${activePass.id}`} className="w-full">
                    <QrCode className="h-4 w-4" /> Show my gate QR
                  </ButtonLink>
                </div>
              ) : !isLoggedIn ? (
                <Button className="w-full" onClick={() => router.push("/login?next=/pronite-pass")}>
                  Sign in to get your pass <ChevronRight className="h-4 w-4" />
                </Button>
              ) : phase === "review" || phase === "done" ? (
                <div className="space-y-2">
                  <ButtonLink href="/dashboard" variant="secondary" className="w-full">
                    Go to dashboard <ChevronRight className="h-4 w-4" />
                  </ButtonLink>
                  {phase === "review" && (
                    <p className="text-center text-xs text-bone/60">
                      Need it sooner?{" "}
                      <Link href="/ask" className="underline">
                        Contact support
                      </Link>
                      {checkout ? ` and quote order ${checkout.publicOrderCode}.` : "."}
                    </p>
                  )}
                </div>
              ) : (
                <Button className="w-full" onClick={startCheckout} disabled={busy || phase === "loading" || !product}>
                  {phase === "creating"
                    ? "Creating order…"
                    : phase === "paying"
                      ? "Opening payment…"
                      : phase === "verifying"
                        ? "Verifying payment…"
                        : phase === "processing"
                          ? "Issuing your pass…"
                          : `Get the Pronite Pass — ${price}`}
                </Button>
              )}
            </div>
            <p className="t-label mt-6 text-center text-bone/40">Secure checkout by Razorpay</p>
          </div>
        </div>
      </section>
    </div>
  );
}
