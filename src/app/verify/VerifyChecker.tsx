"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ShieldCheck,
  Search,
  CheckCircle2,
  XCircle,
  User,
  Building,
  Calendar,
  Clock,
  Sparkles,
  Copy,
  Check,
  AlertTriangle,
  AlertOctagon,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatDateTimeIST, formatDateIST } from "@/lib/dates";

interface VerifyResponseData {
  isReal: boolean;
  valid: boolean;
  status: "ACTIVE" | "EXPIRED" | "REVOKED" | "FAKE_OR_UNRECOGNIZED";
  statusLabel?: string;
  passCode?: string;
  passType?: string;
  productName?: string;
  description?: string;
  accessSummary?: string;
  purchasedAt?: string | null;
  expiresAt?: string | null;
  maskedName?: string | null;
  maskedCollege?: string | null;
  teamName?: string | null;
  festivalName?: string;
  venue?: string;
  message?: string;
}

type Result =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "found"; data: VerifyResponseData }
  | { state: "fake"; query: string; message?: string }
  | { state: "error"; message: string };

export default function VerifyChecker() {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<Result>({ state: "idle" });

  function copyCode(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = query.trim().toUpperCase();
    if (!q) return;
    setResult({ state: "checking" });
    try {
      const res = await fetch("/api/public/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: q }),
      });
      const body = await res.json();
      if (!body.ok) {
        setResult({
          state: "error",
          message:
            body.code === "RATE_LIMITED"
              ? "Too many verification attempts from this network. Please wait a minute and try again."
              : body.message ?? "Verification is unavailable right now.",
        });
        return;
      }
      const data = body.data as VerifyResponseData;
      if (data.isReal) {
        setResult({
          state: "found",
          data,
        });
      } else {
        setResult({
          state: "fake",
          query: q,
          message: data.message,
        });
      }
    } catch {
      setResult({
        state: "error",
        message: "Could not connect to the verification service. Please check your connection and try again.",
      });
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 md:py-16">
      {/* Search box */}
      <form
        onSubmit={handleSubmit}
        className="border-8 border-black bg-white p-6 sm:p-8 shadow-neo-xl"
      >
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center border-4 border-black bg-neo-secondary shadow-neo">
            <ShieldCheck className="h-9 w-9" strokeWidth={3} />
          </div>
          <div>
            <h2 className="text-2xl sm:text-3xl font-black uppercase tracking-tighter">
              Pass &amp; Authenticity Verifier
            </h2>
            <p className="text-sm sm:text-base font-bold text-black/70 mt-0.5">
              Check if a pass is real or fake, when it was purchased, and verify its validity.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 sm:flex-row">
          <div className="relative flex-1">
            <Search
              className="absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-black/60"
              strokeWidth={3}
              aria-hidden
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. PP-4F8A9C12E7B3 or ORD-..."
              aria-label="Pass code, registration code, or order code"
              className="h-14 w-full border-4 border-black bg-white pl-14 pr-4 text-lg font-bold uppercase placeholder:normal-case placeholder:text-black/40 focus-visible:bg-neo-secondary focus-visible:shadow-neo-sm focus-visible:outline-none"
            />
          </div>
          <Button type="submit" variant="primary" disabled={result.state === "checking"} className="h-14 px-8 text-base">
            {result.state === "checking" ? "Checking…" : "Verify Authenticity"}
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t-2 border-black/10 pt-3 text-xs font-bold text-black/60">
          <span>Supports: Pronite Passes (PP-...), Event Registrations (PR-...), and Orders (ORD-...)</span>
          <span className="font-mono text-[11px] text-black/40">Real-time anti-fraud engine</span>
        </div>
      </form>

      {/* Result Display */}
      <div className="mt-8 sm:mt-10" aria-live="polite">
        {/* 1. REAL & AUTHENTIC PASS (VALID OR INACTIVE) */}
        {result.state === "found" && (
          <div className="overflow-hidden border-8 border-black bg-white shadow-neo-xl text-black">
            {/* Authenticity Header Ribbon */}
            <div
              className={`flex flex-wrap items-center justify-between gap-4 border-b-4 border-black px-6 py-4 ${
                result.data.valid
                  ? "bg-green-300 text-green-950"
                  : result.data.status === "EXPIRED"
                  ? "bg-amber-300 text-amber-950"
                  : "bg-red-300 text-red-950"
              }`}
            >
              <div className="flex items-center gap-3">
                {result.data.valid ? (
                  <CheckCircle2 className="h-8 w-8 text-green-900" strokeWidth={3} />
                ) : (
                  <AlertTriangle className="h-8 w-8 text-amber-900" strokeWidth={3} />
                )}
                <div>
                  <p className="text-xl sm:text-2xl font-black uppercase tracking-tight">
                    {result.data.valid
                      ? "✓ Authentic Pass — Verified Real"
                      : result.data.status === "EXPIRED"
                      ? "Authentic Pass — Expired"
                      : "Authentic Pass — Revoked / Inactive"}
                  </p>
                  <p className="text-xs font-bold uppercase tracking-wider opacity-80">
                    Official TARANG 2026 Database Record
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-black animate-pulse" />
                <Badge variant="black" className="text-white text-xs font-black">
                  {result.data.valid ? "REAL & VALID" : result.data.status}
                </Badge>
              </div>
            </div>

            {/* Pass Body Content */}
            <div className="p-6 sm:p-8 space-y-6">
              {/* Product Title & Code Header */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between border-b-4 border-black/10 pb-6">
                <div>
                  <span className="inline-block border-2 border-black bg-neo-secondary px-2.5 py-0.5 text-xs font-black uppercase mb-2">
                    {result.data.passType === "DELEGATE"
                      ? "Pronite Pass"
                      : result.data.passType === "BASIC"
                      ? "Basic Card (retired)"
                      : "Official Fest Entity"}
                  </span>
                  <h3 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">
                    {result.data.productName}
                  </h3>
                  <p className="text-sm font-bold text-black/70 mt-1">
                    {result.data.festivalName || "TARANG 2026"} · {result.data.venue || "NIT Patna"}
                  </p>
                </div>

                {result.data.passCode && (
                  <div className="border-4 border-black bg-neo-cream p-3 text-center sm:text-right shrink-0">
                    <span className="text-[10px] font-black uppercase tracking-widest text-black/60 block">
                      Pass Code
                    </span>
                    <p className="font-mono text-xl sm:text-2xl font-black tracking-wider text-black mt-0.5">
                      {result.data.passCode}
                    </p>
                    <button
                      type="button"
                      onClick={() => copyCode(result.data.passCode!)}
                      className="mt-2 inline-flex items-center gap-1 border-2 border-black bg-white px-2.5 py-1 text-[11px] font-black uppercase shadow-neo-sm hover:bg-neo-secondary active:shadow-none"
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 text-green-700" strokeWidth={3} />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy Code</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Purchase Details & Authenticity Matrix */}
              <div className="grid gap-4 sm:grid-cols-2">
                {/* When was it purchased */}
                <div className="border-4 border-black bg-neo-cream/50 p-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-black/60 mb-1">
                    <Calendar className="h-4 w-4" />
                    <span>Purchased / Activated On</span>
                  </div>
                  <p className="text-base sm:text-lg font-black text-black">
                    {result.data.purchasedAt ? formatDateTimeIST(result.data.purchasedAt) : "Confirmed upon checkout"}
                  </p>
                  <p className="text-[11px] font-bold text-black/50 mt-1 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Timestamp verified in order ledger
                  </p>
                </div>

                {/* Validity Period */}
                <div className="border-4 border-black bg-neo-cream/50 p-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-black/60 mb-1">
                    <ShieldCheck className="h-4 w-4 text-green-700" />
                    <span>Validity Status</span>
                  </div>
                  <p className="text-base sm:text-lg font-black text-black">
                    {result.data.valid
                      ? "Active & Ready for Gate Entry"
                      : result.data.status === "EXPIRED"
                      ? "Expired Pass"
                      : "Revoked / Void"}
                  </p>
                  <p className="text-[11px] font-bold text-black/50 mt-1">
                    {result.data.expiresAt
                      ? `Valid through ${formatDateIST(result.data.expiresAt)}`
                      : "Valid for TARANG 2026 (21–22 Nov 2026)"}
                  </p>
                </div>

                {/* Registered Attendee */}
                {result.data.maskedName && (
                  <div className="border-4 border-black bg-neo-cream/50 p-4">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-black/60 mb-1">
                      <User className="h-4 w-4" />
                      <span>Registered Attendee</span>
                    </div>
                    <p className="text-base sm:text-lg font-black text-black font-mono">
                      {result.data.maskedName}
                    </p>
                    <p className="text-[11px] font-bold text-black/50 mt-1">
                      Privacy-protected name masking
                    </p>
                  </div>
                )}

                {/* College / Institution */}
                {result.data.maskedCollege && (
                  <div className="border-4 border-black bg-neo-cream/50 p-4">
                    <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-black/60 mb-1">
                      <Building className="h-4 w-4" />
                      <span>College / Institution</span>
                    </div>
                    <p className="text-base sm:text-lg font-black text-black">
                      {result.data.maskedCollege}
                    </p>
                    <p className="text-[11px] font-bold text-black/50 mt-1">
                      Must match attendee student ID at gate
                    </p>
                  </div>
                )}
              </div>

              {/* Inclusions & Access Privileges */}
              {result.data.accessSummary && (
                <div className="border-4 border-black bg-neo-secondary/30 p-4">
                  <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-black/70 mb-1">
                    <Sparkles className="h-4 w-4 text-black" />
                    <span>Included Access &amp; Privileges</span>
                  </div>
                  <p className="text-sm sm:text-base font-bold text-black">
                    {result.data.accessSummary}
                  </p>
                </div>
              )}

              {/* Official Gate Notice */}
              <div className="border-t-2 border-black/10 pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 text-xs font-bold text-black/60">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-green-700 shrink-0" />
                  <span>Verified authentic. Present your QR code / pass code with College ID at venue gates.</span>
                </div>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-1 font-black uppercase text-black hover:underline underline-offset-4"
                >
                  <span>Go to My Passes</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* 2. FAKE OR UNRECOGNIZED PASS */}
        {result.state === "fake" && (
          <div className="border-8 border-black bg-neo-accent p-6 sm:p-8 text-black shadow-neo-xl">
            <div className="flex items-center justify-center gap-3">
              <div className="flex h-14 w-14 items-center justify-center border-4 border-black bg-white shadow-neo">
                <XCircle className="h-8 w-8 text-red-600" strokeWidth={3} />
              </div>
              <Badge variant="black" className="text-white text-xs font-black">
                FAKE / UNVERIFIED
              </Badge>
            </div>

            <h3 className="mt-4 text-center text-2xl sm:text-3xl font-black uppercase tracking-tight">
              Fake or Unrecognized Pass
            </h3>

            <p className="mx-auto mt-2 max-w-xl text-center text-base sm:text-lg font-bold leading-snug">
              No active pass, card, or registration exists with the code{" "}
              <span className="border-2 border-black bg-white px-2 py-0.5 font-mono font-black">
                {result.query}
              </span>{" "}
              in the official TARANG 2026 database.
            </p>

            <div className="mt-6 border-4 border-black bg-white p-5 space-y-3 text-left">
              <div className="flex items-start gap-2.5">
                <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" strokeWidth={2.5} />
                <div>
                  <p className="font-black text-sm uppercase">Anti-Fraud &amp; Counterfeit Warning</p>
                  <p className="text-xs font-bold text-black/70 mt-0.5 leading-relaxed">
                    If this code was provided by a third-party seller, scalper, or unofficial channel, it is likely fraudulent or invalid. Official passes are only issued through this website.
                  </p>
                </div>
              </div>

              <div className="border-t-2 border-black/10 pt-3 text-xs font-bold text-black/80 space-y-1.5">
                <p className="font-black uppercase text-black">Recommended steps:</p>
                <ul className="list-disc list-inside space-y-1 text-black/70">
                  <li>Check your confirmation email from TARANG 2026 for the exact pass code.</li>
                  <li>Log in to your <Link href="/dashboard" className="font-black underline">TARANG Dashboard</Link> to view all passes issued to your account.</li>
                  <li>If you need assistance, visit the TARANG help desk on campus with your payment receipt.</li>
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* 3. ERROR STATE */}
        {result.state === "error" && (
          <div className="border-8 border-black bg-white p-6 sm:p-8 text-center shadow-neo-xl">
            <AlertTriangle className="mx-auto h-12 w-12 text-amber-500" strokeWidth={3} />
            <h3 className="mt-3 text-xl sm:text-2xl font-black uppercase tracking-tight">
              Verification Unavailable
            </h3>
            <p className="mx-auto mt-2 max-w-md text-sm sm:text-base font-bold text-black/70">
              {result.message}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
