"use client";

import { useState } from "react";
import { Copy, Check, ShieldCheck, User, Building, Mail, Calendar, Ticket } from "lucide-react";
import { formatDateIST } from "@/lib/dates";

interface BasicCardViewProps {
  passId?: string;
  passCode: string;
  state: string;
  productName?: string;
  userName?: string | null;
  collegeName?: string | null;
  email?: string | null;
  expiresAt?: string | null;
  className?: string;
}

export default function BasicCardView({
  passCode,
  state,
  productName = "TARANG BR Card",
  userName,
  collegeName,
  email,
  expiresAt,
  className = "",
}: BasicCardViewProps) {
  const [copied, setCopied] = useState(false);

  function copyCode() {
    navigator.clipboard.writeText(passCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className={`relative overflow-hidden border-8 border-black bg-white text-black shadow-neo-xl ${className}`}
    >
      {/* Header Badge Strip */}
      <div className="flex flex-wrap items-center justify-between border-b-4 border-black bg-neo-cream px-6 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center border-2 border-black bg-neo-accent text-black shadow-neo-sm">
            <Ticket className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <span className="text-xs font-black uppercase tracking-wider text-black">
            Official Participant Card
          </span>
        </div>
        <div className="flex items-center gap-2 border-2 border-black bg-green-200 px-2.5 py-0.5 text-xs font-mono font-black uppercase text-green-900 shadow-neo-sm">
          <span className="inline-block h-2 w-2 rounded-full bg-green-600 animate-pulse" />
          {state}
        </div>
      </div>

      {/* Main Card Content */}
      <div className="p-6 sm:p-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          {/* Left: Product & Attendee Info */}
          <div className="space-y-4 flex-1">
            <div>
              <span className="inline-block border-2 border-black bg-neo-secondary px-2.5 py-0.5 text-[11px] font-black uppercase text-black mb-1">
                Standard Campus Entry
              </span>
              <h3 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">
                {productName}
              </h3>
              <p className="text-xs font-bold text-black/70 mt-0.5">
                TARANG 2026 · AIIMS New Delhi · 17–21 September 2026
              </p>
            </div>

            {/* Attendee Details Box */}
            <div className="space-y-2 rounded border-2 border-black/20 bg-neo-cream/60 p-3.5 text-xs font-bold">
              {userName && (
                <div className="flex items-center gap-2 text-black">
                  <User className="h-3.5 w-3.5 shrink-0 text-black/60" />
                  <span className="font-black">{userName}</span>
                </div>
              )}
              {collegeName && (
                <div className="flex items-center gap-2 text-black/80">
                  <Building className="h-3.5 w-3.5 shrink-0 text-black/60" />
                  <span>{collegeName}</span>
                </div>
              )}
              {email && (
                <div className="flex items-center gap-2 text-black/70 font-mono">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-black/60" />
                  <span>{email}</span>
                </div>
              )}
              {expiresAt && (
                <div className="flex items-center gap-2 text-black/60">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-black/60" />
                  <span>Valid through: {formatDateIST(expiresAt)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right: Unique Verification String */}
          <div className="w-full md:w-72 shrink-0">
            <div className="border-4 border-black bg-neo-cream p-4 shadow-neo text-center">
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-black/60 block">
                Unique Gate Verification Code
              </span>
              <p className="font-mono text-2xl sm:text-3xl font-black tracking-widest text-black mt-1 selection:bg-neo-accent">
                {passCode}
              </p>

              <button
                type="button"
                onClick={copyCode}
                className="mt-3 w-full flex items-center justify-center gap-1.5 border-2 border-black bg-white dark:bg-[#121214] text-black dark:text-white py-1.5 px-3 text-xs font-black uppercase shadow-neo-sm hover:bg-neo-secondary dark:hover:bg-neo-secondary dark:hover:text-black active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-green-700 dark:text-green-400" strokeWidth={3} />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy Verification Code</span>
                  </>
                )}
              </button>

              <p className="mt-2 text-[10px] font-bold text-black/60 leading-tight">
                Staff verify this string with your email at the gate.
              </p>
            </div>
          </div>
        </div>

        {/* Inclusions Footer */}
        <div className="mt-6 pt-4 border-t-2 border-black/10 flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-black/70">
          <div className="flex items-center gap-1.5 text-green-800 dark:text-green-400">
            <ShieldCheck className="h-4 w-4 shrink-0 text-green-700 dark:text-green-400" />
            <span>5-Day General Campus Access &amp; Competition Eligibility Cleared</span>
          </div>
          <span className="text-[11px] text-black/50 font-mono">
            ID: {passCode}
          </span>
        </div>
      </div>
    </div>
  );
}
