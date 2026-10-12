"use client";

import Link from "next/link";
import { CheckCircle2, Lock, ArrowRight, ShieldCheck, Sparkles, AlertCircle } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";

interface BasicCardPrerequisiteGateProps {
  isLoggedIn: boolean;
  hasBasicCard: boolean;
  hasDelegatePass: boolean;
  basicPassCode?: string | null;
}

export default function BasicCardPrerequisiteGate({
  isLoggedIn: _isLoggedIn,
  hasBasicCard,
  hasDelegatePass,
  basicPassCode,
}: BasicCardPrerequisiteGateProps) {
  if (hasDelegatePass) {
    return null; // Already holds VIP Delegate Pass
  }

  return (
    <div className="border-8 border-black bg-white p-6 shadow-neo-xl">
      <div className="flex items-center justify-between border-b-4 border-black pb-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center border-2 border-black bg-neo-secondary shadow-neo-sm">
            <ShieldCheck className="h-5 w-5 text-black" strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="text-lg font-black uppercase tracking-tight">
              Card Prerequisite Requirement
            </h3>
            <p className="text-xs font-bold text-black/60">
              TARANG 2026 Multi-Tier Card Policy
            </p>
          </div>
        </div>
        <span
          className={`border-2 border-black px-2.5 py-1 text-xs font-black uppercase shadow-neo-sm ${
            hasBasicCard
              ? "bg-green-300 text-black"
              : "bg-neo-accent text-black"
          }`}
        >
          {hasBasicCard ? "✓ Step 1 Cleared" : "Action Required"}
        </span>
      </div>

      {/* 2-Step Progress Indicator */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {/* Step 1: Basic Card */}
        <div
          className={`border-4 border-black p-4 shadow-neo transition-all ${
            hasBasicCard ? "bg-green-50 border-green-700" : "bg-neo-cream"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center border-2 border-black bg-black text-xs font-black text-white">
                1
              </span>
              <h4 className="text-sm font-black uppercase">TARANG BR Card (₹200)</h4>
            </div>
            {hasBasicCard ? (
              <span className="flex items-center gap-1 text-xs font-black text-green-700">
                <CheckCircle2 className="h-4 w-4" /> Active
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-black text-amber-700">
                <AlertCircle className="h-4 w-4" /> Required
              </span>
            )}
          </div>

          <p className="mt-2 text-xs font-bold text-black/70">
            {hasBasicCard
              ? `Verified card active: ${basicPassCode ?? "Standard Entry"}. General campus entry cleared.`
              : "Standard 5-day festival entry card. Mandatory to participate in any event and enter campus."}
          </p>

          {!hasBasicCard && (
            <div className="mt-4">
              <ButtonLink
                href="/basic-card"
                variant="primary"
                className="w-full text-center text-xs py-2"
              >
                Get TARANG BR Card (₹200) First <ArrowRight className="h-3.5 w-3.5" />
              </ButtonLink>
            </div>
          )}
        </div>

        {/* Step 2: VIP Delegate Pass */}
        <div
          className={`border-4 border-black p-4 shadow-neo transition-all ${
            hasBasicCard
              ? "bg-neo-secondary/30 border-black"
              : "bg-gray-100 opacity-80"
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center border-2 border-black bg-neo-secondary text-xs font-black text-black">
                2
              </span>
              <h4 className="text-sm font-black uppercase">Delegate Card (Pro Nights)</h4>
            </div>
            {hasBasicCard ? (
              <span className="flex items-center gap-1 text-xs font-black text-black">
                <Sparkles className="h-4 w-4 fill-black" /> Unlocked
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-black text-black/60">
                <Lock className="h-4 w-4" /> Locked
              </span>
            )}
          </div>

          <p className="mt-2 text-xs font-bold text-black/70">
            {hasBasicCard
              ? "Step 1 complete! You are ready to purchase the All-Access Delegate Card (₹2,000) for Star Nights below."
              : "All 5 pro-shows, star concerts, VIP front-row stage zone, and artist lounge. Unlocks after Step 1."}
          </p>

          {!hasBasicCard && (
            <p className="mt-3 text-[11px] font-black uppercase text-black/60">
              🔒 Locked until BR Card is purchased
            </p>
          )}
        </div>
      </div>

      {!hasBasicCard && (
        <div className="mt-5 border-2 border-black bg-neo-accent/20 p-3 text-xs font-bold text-black flex items-center justify-between gap-3">
          <p>
            👉 <strong>Step 1 is mandatory:</strong> Please register for your TARANG BR Card (₹200) first to enable the Delegate Card checkout.
          </p>
          <Link
            href="/basic-card"
            className="shrink-0 font-black uppercase underline hover:text-neo-accent text-xs"
          >
            Go to BR Card →
          </Link>
        </div>
      )}
    </div>
  );
}
