"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Clock,
  MapPin,
  Trophy,
  Users,
  ShieldCheck,
  CheckCircle2,
  Sparkles,
  X,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatPaise } from "@/lib/money";
import { ensureRazorpayLoaded } from "@/lib/razorpay-loader";
import type { EventRead } from "@/domain/content";

interface UserPass {
  id: string;
  publicPassCode: string;
  state: string;
  productName: string;
  isBasePass: boolean;
}

interface EventRegistrationModalProps {
  event: EventRead | null;
  onClose: () => void;
}

interface CheckoutData {
  localOrderId: string;
  publicOrderCode: string;
  razorpayOrderId: string | null;
  razorpayKeyId: string | null;
  amountPaise: number;
  currency: string;
  status: string;
}

export default function EventRegistrationModal({
  event,
  onClose,
}: EventRegistrationModalProps) {
  const router = useRouter();
  const [loadingPasses, setLoadingPasses] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userPasses, setUserPasses] = useState<UserPass[]>([]);
  const [phase, setPhase] = useState<
    "idle" | "creating" | "paying" | "verifying" | "processing" | "done" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [registrationCode, setRegistrationCode] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check auth and passes on open
  useEffect(() => {
    if (!event) return;
    let isMounted = true;
    (async () => {
      setLoadingPasses(true);
      try {
        const res = await fetch("/api/me/passes");
        if (res.status === 401) {
          if (isMounted) {
            setIsLoggedIn(false);
            setUserPasses([]);
          }
          return;
        }
        const body = await res.json();
        if (isMounted) {
          setIsLoggedIn(true);
          if (body.ok && Array.isArray(body.data?.passes)) {
            setUserPasses(body.data.passes);
          }
        }
      } catch {
        if (isMounted) setIsLoggedIn(false);
      } finally {
        if (isMounted) setLoadingPasses(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [event]);

  // Load Razorpay SDK
  useEffect(() => {
    if (document.getElementById("razorpay-sdk")) return;
    const script = document.createElement("script");
    script.id = "razorpay-sdk";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    document.body.appendChild(script);
  }, []);

  const hasActivePass = userPasses.some((p) => p.state === "ACTIVE");
  const pollFnRef = useRef<(orderId: string, attempt: number) => void>(() => {});

  const pollOrderStatus = useCallback(
    async (orderId: string, attempt = 0) => {
      if (attempt > 10) {
        setPhase("done");
        setMessage("Your registration is being processed! Check your dashboard shortly.");
        return;
      }
      try {
        const res = await fetch(`/api/checkout/orders/${orderId}`);
        const body = await res.json();
        if (body.ok) {
          const status = body.data.status as string;
          if (status === "FULFILLED") {
            setPhase("done");
            setRegistrationCode(body.data.publicOrderCode || `REG-${orderId.slice(0, 8).toUpperCase()}`);
            setMessage("Registration confirmed! You're all set to compete.");
            return;
          }
        }
      } catch {
        // Retry
      }
      const delay = Math.min(2000 * 2 ** attempt, 10000);
      pollTimerRef.current = setTimeout(() => void pollFnRef.current(orderId, attempt + 1), delay);
    },
    []
  );

  useEffect(() => {
    pollFnRef.current = pollOrderStatus;
  }, [pollOrderStatus]);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  if (!event) return null;

  async function handleRegister() {
    if (!event) return;
    setPhase("creating");
    setMessage("");

    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`/api/checkout/events/${event.id}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          registrationMode: event.registrationMode || "INDIVIDUAL",
        }),
      });

      const body = await res.json();
      if (!res.ok || !body.ok) {
        if (body.code === "PROFILE_INCOMPLETE") {
          router.push("/complete-profile");
          return;
        }
        throw new Error(body.message || "Checkout creation failed");
      }

      const checkoutData = body.data as CheckoutData;

      // Free event: instant fulfillment
      if (checkoutData.amountPaise === 0 || checkoutData.status === "FULFILLED") {
        setPhase("done");
        setRegistrationCode(checkoutData.publicOrderCode);
        setMessage("Registration confirmed! You are registered for this event.");
        return;
      }

      // Paid event: open Razorpay
      const loaded = await ensureRazorpayLoaded();
      const RazorpayCtor = window.Razorpay;
      if (!loaded || !RazorpayCtor) {
        throw new Error("Payment SDK failed to load. Please check your connection and retry.");
      }

      setPhase("paying");
      const rzp = new RazorpayCtor({
        key: checkoutData.razorpayKeyId,
        order_id: checkoutData.razorpayOrderId,
        amount: checkoutData.amountPaise,
        currency: checkoutData.currency || "INR",
        name: "PULSE 2026",
        description: `Registration for ${event.name}`,
        theme: { color: "#ff6b6b" },
        handler: async (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          setPhase("verifying");
          try {
            const vRes = await fetch("/api/checkout/razorpay/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
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
            setPhase("processing");
            setMessage("Payment received! Finalizing registration…");
            pollOrderStatus(checkoutData.localOrderId);
          } catch {
            setPhase("processing");
            setMessage("Checking payment status…");
            pollOrderStatus(checkoutData.localOrderId);
          }
        },
        modal: {
          ondismiss: () => {
            setPhase("idle");
            setMessage("Payment window closed. You can retry whenever you are ready.");
            void fetch(`/api/checkout/orders/${checkoutData.localOrderId}/cancel`, { method: "POST" });
          },
        },
      });
      rzp.on("payment.failed", () => {
        setPhase("idle");
        setMessage("Payment could not be completed. No money was deducted.");
        void fetch(`/api/checkout/orders/${checkoutData.localOrderId}/cancel`, { method: "POST" });
      });
      rzp.open();
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Registration failed. Please retry.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-lg border-8 border-black bg-white p-6 shadow-neo-xl">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 border-2 border-black bg-white p-1 text-black shadow-neo-sm hover:bg-neo-accent"
          aria-label="Close modal"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="border-b-4 border-black pb-4">
          <div className="flex items-start gap-4">
            {event.imageUrl && (
              <div className="relative h-16 w-16 shrink-0 overflow-hidden border-3 border-black bg-neo-cream shadow-neo-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={event.imageUrl}
                  alt={event.name}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="border-2 border-black bg-neo-secondary px-2 py-0.5 text-xs font-black uppercase">
                  {event.category.name}
                </span>
                <span className="text-xs font-black uppercase text-black/60">
                  Day {event.day}
                </span>
              </div>
              <h2 className="mt-1 text-2xl sm:text-3xl font-black uppercase tracking-tight">
                {event.name}
              </h2>
              <p className="mt-1 text-xs font-bold text-black/70 line-clamp-2">
                {event.shortDescription || event.description}
              </p>
            </div>
          </div>
        </div>

        {/* Loading state */}
        {loadingPasses ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-black" />
            <p className="mt-2 font-mono text-xs font-bold uppercase tracking-wider">
              Loading…
            </p>
          </div>
        ) : !isLoggedIn ? (
          /* NOT LOGGED IN STATE */
          <div className="py-6 space-y-4">
            <div className="border-4 border-black bg-neo-cream p-4">
              <h3 className="font-black uppercase text-sm">Sign In Required</h3>
              <p className="mt-1 text-xs font-bold text-black/70">
                Please sign in to your account to register for competitions.
              </p>
            </div>
            <Button
              variant="dark"
              className="w-full"
              onClick={() => router.push(`/login?next=/events`)}
            >
              Sign In to Register →
            </Button>
          </div>
        ) : phase === "done" ? (
          /* REGISTRATION SUCCESS STATE */
          <div className="py-6 space-y-4 text-center animate-in zoom-in-95">
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-green-400 border-4 border-black">
              <CheckCircle2 className="h-7 w-7 text-black" strokeWidth={3} />
            </div>
            <h3 className="text-2xl font-black uppercase">Registration Confirmed!</h3>
            <p className="text-xs font-bold text-black/70">{message}</p>
            {registrationCode && (
              <div className="border-4 border-black bg-neo-secondary p-3">
                <span className="text-[10px] font-black uppercase tracking-widest text-black/60">
                  Your Registration Code
                </span>
                <p className="text-xl font-black font-mono tracking-wider">{registrationCode}</p>
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <Link
                href="/dashboard"
                className="flex-1 border-4 border-black bg-black p-3 text-center text-xs font-black uppercase text-white shadow-neo-sm hover:bg-zinc-800"
              >
                View in My Dashboard →
              </Link>
              <Button variant="outline" className="text-xs" onClick={onClose}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          /* EVENT CHECKOUT */
          <div className="py-6 space-y-4">
            {/* Optional Pass Recognition Banner if user holds a pass */}
            {hasActivePass && (
              <div className="flex items-center justify-between border-2 border-black bg-green-50 p-2.5 px-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-green-700" />
                  <span className="text-xs font-black uppercase text-green-800">
                    Linked Festival Card
                  </span>
                </div>
                <span className="text-[10px] font-mono font-bold text-green-700">
                  {userPasses[0]?.productName ?? "Active Card"}
                </span>
              </div>
            )}

            {/* Event Specs Grid */}
            <div className="grid grid-cols-2 gap-2 text-xs font-bold">
              <div className="border-2 border-black bg-neo-cream p-2 flex items-center gap-2">
                <Calendar className="h-4 w-4 shrink-0" />
                <span>{event.dateLabel}</span>
              </div>
              <div className="border-2 border-black bg-neo-cream p-2 flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0" />
                <span className="truncate">{event.timeLabel}</span>
              </div>
              <div className="border-2 border-black bg-neo-cream p-2 flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0" />
                <span className="truncate">{event.venue?.name ?? "Campus"}</span>
              </div>
              <div className="border-2 border-black bg-neo-cream p-2 flex items-center gap-2">
                <Users className="h-4 w-4 shrink-0" />
                <span>{event.registrationMode === "TEAM" ? "Team Event" : "Individual"}</span>
              </div>
            </div>

            {/* Pricing Summary */}
            <div className="border-4 border-black bg-white p-3 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-black/60">
                  Competition Entry Fee
                </span>
                <p className="text-2xl font-black">
                  {event.amountPaise === 0 ? "FREE" : formatPaise(event.amountPaise)}
                </p>
              </div>
              {event.prizePoolText && (
                <div className="text-right">
                  <span className="text-[10px] font-black uppercase tracking-widest text-black/60 flex items-center gap-1 justify-end">
                    <Trophy className="h-3 w-3" /> Prize Pool
                  </span>
                  <p className="text-sm font-black text-neo-accent">{event.prizePoolText}</p>
                </div>
              )}
            </div>

            {message && (
              <p
                className={`border-2 border-black p-2 text-xs font-bold ${
                  phase === "error" ? "bg-neo-accent text-black" : "bg-neo-secondary text-black"
                }`}
              >
                {message}
              </p>
            )}

            {/* Submit Action Button */}
            <Button
              variant="primary"
              className="w-full py-3 text-sm flex items-center justify-center gap-2"
              onClick={handleRegister}
              disabled={phase !== "idle" && phase !== "error"}
            >
              {phase === "creating" || phase === "verifying" || phase === "processing" ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Processing…
                </>
              ) : phase === "paying" ? (
                <>
                  <Sparkles className="h-4 w-4" /> Complete Payment in Gateway…
                </>
              ) : event.amountPaise === 0 ? (
                "Confirm Free Registration →"
              ) : (
                `Pay ${formatPaise(event.amountPaise)} & Register →`
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
