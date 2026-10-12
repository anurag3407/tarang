import Link from "next/link";
import { Sparkles, Zap, QrCode, Music, Star } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { formatDateIST } from "@/lib/dates";

interface ConcertPassCardProps {
  passId: string;
  passCode: string;
  state: string;
  productName?: string;
  priceLabel?: string;
  userName?: string | null;
  collegeName?: string | null;
  expiresAt?: string | null;
  showQrLink?: boolean;
  className?: string;
}

export default function ConcertPassCard({
  passId,
  passCode,
  state,
  productName = "VIP All-Access Delegate Card",
  priceLabel,
  userName,
  collegeName,
  expiresAt,
  showQrLink = true,
  className = "",
}: ConcertPassCardProps) {
  return (
    <div
      className={`relative overflow-hidden border-8 border-black bg-black text-white shadow-neo-xl ${className}`}
    >
      {/* Decorative background grid & glow */}
      <div className="absolute inset-0 bg-[radial-gradient(#ffde59_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none" />
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-neo-secondary/20 blur-2xl pointer-events-none" />
      <div className="absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-neo-accent/20 blur-2xl pointer-events-none" />

      {/* Top Banner Ribbon */}
      <div className="flex flex-wrap items-center justify-between border-b-4 border-black bg-neo-secondary px-6 py-3 text-black">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 fill-black" />
          <span className="text-xs font-black uppercase tracking-[0.2em]">
            Official VIP Concert Card
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs font-black uppercase tracking-wider">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
          {state}
        </div>
      </div>

      {/* Main Ticket Body */}
      <div className="p-6 sm:p-8">
        <div className="grid gap-8 lg:grid-cols-3">
          {/* Left / Center: Card Details (2 Cols) */}
          <div className="space-y-6 lg:col-span-2">
            <div>
              <div className="inline-flex items-center gap-2 border-2 border-neo-secondary bg-neo-secondary/10 px-3 py-1 text-neo-secondary text-xs font-black uppercase tracking-widest">
                <Music className="h-3.5 w-3.5" />
                All 5 Star Night Pro Shows Included
              </div>
              <h3 className="mt-2 text-3xl sm:text-4xl font-black uppercase tracking-tight text-white">
                {productName}
              </h3>
              <p className="mt-1 text-sm font-bold text-white/70">
                PULSE 2026 · AIIMS New Delhi · 17–21 Sep 2026
              </p>
            </div>

            {/* Card Code Box */}
            <div className="border-4 border-neo-secondary/40 bg-zinc-900/90 p-4 shadow-inner">
              <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/50">
                Authorized Card Code
              </span>
              <p className="font-mono text-2xl sm:text-3xl font-black tracking-widest text-neo-secondary">
                {passCode}
              </p>
              {userName && (
                <p className="mt-1 text-xs font-bold text-white/80">
                  Issued to: <span className="text-white font-black">{userName}</span>
                  {collegeName ? ` (${collegeName})` : ""}
                </p>
              )}
            </div>

            {/* Included VIP Benefits Badges */}
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-white/60 mb-2">
                Included VIP Entitlements:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-bold">
                <div className="flex items-center gap-2 border border-white/20 bg-white/5 px-3 py-2">
                  <Star className="h-4 w-4 text-neo-secondary shrink-0 fill-neo-secondary" />
                  <span>All 5 Star Concerts & Pro Shows</span>
                </div>
                <div className="flex items-center gap-2 border border-white/20 bg-white/5 px-3 py-2">
                  <Zap className="h-4 w-4 text-neo-accent shrink-0 fill-neo-accent" />
                  <span>Express Fast-Track Gate Entry</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Ticket Stub / QR Action */}
          <div className="flex flex-col justify-between border-t-4 border-dashed border-white/20 pt-6 lg:border-t-0 lg:border-l-4 lg:pl-8 lg:pt-0">
            <div className="space-y-4">
              <div className="border-4 border-black bg-neo-accent p-4 text-center text-black shadow-neo-sm">
                <p className="text-[11px] font-black uppercase tracking-widest">
                  VIP Concert Tier
                </p>
                <p className="text-2xl font-black uppercase tracking-tight">
                  {priceLabel ? `${priceLabel} Card` : "VIP Card"}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-wider text-black/80">
                  Full 5-Day All-Access
                </p>
              </div>

              {/* Barcode visual */}
              <div className="hidden sm:flex justify-center items-center py-2 bg-white px-4 border-2 border-black">
                <div className="h-10 w-full flex items-center justify-between gap-1 overflow-hidden opacity-90">
                  {Array.from({ length: 28 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-full bg-black"
                      style={{
                        width: `${((i % 4) + 1) * 2}px`,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {showQrLink && (
              <div className="mt-6 space-y-2">
                <ButtonLink
                  href={`/dashboard/pass/${passId}`}
                  variant="secondary"
                  className="w-full flex items-center justify-center gap-2 text-center"
                >
                  <QrCode className="h-5 w-5" />
                  Show Gate QR Card
                </ButtonLink>
                <Link
                  href="/schedule"
                  className="block text-center text-xs font-black uppercase text-white/60 hover:text-neo-secondary underline"
                >
                  View Pro Shows Schedule →
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Footer Note */}
        <div className="mt-6 border-t-2 border-white/10 pt-4 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-white/50">
          <span>⚠ Present QR card at Main Gate & Pro-Show Arena for entry.</span>
          {expiresAt && <span>Valid through: {formatDateIST(expiresAt)}</span>}
        </div>
      </div>
    </div>
  );
}
