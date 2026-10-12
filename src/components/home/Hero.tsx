import Image from "next/image";
import { Star, ArrowRight, Sparkles, Ticket } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import { PillBadge } from "@/components/ui/Badge";
import { FEST } from "@/lib/data";

export default function Hero() {
  return (
    <section className="relative overflow-hidden border-b-8 border-black bg-neo-cream">
      {/* Texture + floating background shapes */}
      <div className="bg-grid-neo absolute inset-0" aria-hidden />
      <div
        className="absolute -top-8 -left-8 h-24 w-24 rotate-12 border-4 border-black bg-neo-secondary shadow-neo opacity-70 sm:-top-10 sm:-left-10 sm:h-40 sm:w-40 sm:border-8"
        aria-hidden
      />
      <Star
        className="animate-spin-slow absolute bottom-12 left-8 hidden h-14 w-14 fill-neo-accent stroke-black md:block"
        strokeWidth={2}
        aria-hidden
      />
      {/* Mobile-only accent star (the md+ one sits bottom-left, below the fold on phones) */}
      <Star
        className="animate-spin-slow absolute right-4 top-20 h-8 w-8 fill-neo-accent stroke-black md:hidden"
        strokeWidth={2}
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-8 sm:px-6 sm:pb-16 sm:pt-12 md:pb-24 md:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          {/* Left — copy (7 cols on lg, full width on mobile) */}
          <div className="flex flex-col gap-4 sm:gap-6 lg:col-span-7">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <PillBadge variant="accent" className="-rotate-2 whitespace-nowrap">
                <Sparkles className="h-4 w-4" strokeWidth={3} />
                {FEST.edition}
              </PillBadge>
              <PillBadge variant="secondary" className="rotate-1 whitespace-nowrap">
                {FEST.college}
              </PillBadge>
              <span className="inline-flex items-center gap-1.5 border-2 border-black bg-white px-2.5 py-1 text-xs font-black uppercase tracking-wider shadow-neo-xs">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Cards Live
              </span>
            </div>

            <h1 className="text-6xl font-black uppercase leading-[0.88] tracking-tighter sm:text-7xl md:text-8xl lg:text-8xl xl:text-9xl">
              <span className="block">Feel</span>
              <span className="block">
                The{" "}
                <span className="inline-block -rotate-2 bg-neo-accent px-3 py-0.5 text-white text-shadow-neo">
                  Beat.
                </span>
              </span>
              <span className="text-stroke block">Live The</span>
              <span className="block">
                <span className="inline-block rotate-1 bg-black px-4 py-0.5 text-neo-secondary">
                  Pulse.
                </span>
              </span>
            </h1>

            {/* Mobile mascot ticket — gives phones the branding moment the desktop showcase owns */}
            <div className="relative -rotate-1 self-start lg:hidden">
              <div
                className="absolute -inset-1.5 rotate-2 border-2 border-black bg-neo-accent/25"
                aria-hidden
              />
              <div className="relative flex items-center gap-3 border-4 border-black bg-white dark:bg-[#121214] p-2.5 pr-5 shadow-neo-sm">
                <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden border-2 border-black bg-white dark:bg-[#0c0c0e] sm:h-24 sm:w-24">
                  <div className="bg-halftone absolute inset-0 opacity-20" aria-hidden />
                  <Image
                    src="/pulse-logo.png"
                    alt={`${FEST.name} ${FEST.year} mascot`}
                    width={96}
                    height={96}
                    unoptimized
                    priority
                    className="relative z-10 h-full w-full object-contain p-1"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-xl font-black uppercase leading-none tracking-tighter text-black dark:text-white sm:text-2xl">
                    {FEST.name} <span className="text-neo-accent">{FEST.year}</span>
                  </p>
                  <p className="mt-1.5 text-[10px] font-black uppercase tracking-widest text-black/60 dark:text-zinc-400 sm:text-xs">
                    {FEST.college}
                  </p>
                  <span className="mt-1.5 inline-block -rotate-1 border-2 border-black bg-neo-secondary px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-black shadow-[2px_2px_0px_0px_#000] sm:text-xs">
                    {FEST.datesShort}
                  </span>
                </div>
              </div>
            </div>

            <p className="max-w-xl text-base font-bold leading-snug sm:text-xl md:text-2xl">
              {FEST.days} days. 250+ events. 5 pro shows. South Asia’s largest medical
              college cultural extravaganza returns to the AIIMS campus —{" "}
              <span className="bg-neo-secondary text-black font-black px-1.5 py-0.5 border-2 border-black inline-block -rotate-1 shadow-[2px_2px_0px_0px_#000]">
                {FEST.dates}
              </span>.
            </p>

            <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:flex-wrap sm:gap-4">
              <ButtonLink href="/events" variant="primary">
                Explore Events <ArrowRight className="h-5 w-5" strokeWidth={3} />
              </ButtonLink>
              {/* Two-up row on mobile, rejoins the button row from sm+ */}
              <div className="grid grid-cols-2 gap-3 sm:contents">
                <ButtonLink href="/delegate-card" variant="secondary">
                  <Ticket className="h-5 w-5" strokeWidth={2.5} />
                  Get Cards
                </ButtonLink>
                <ButtonLink href="/schedule" variant="outline">
                  Schedule
                </ButtonLink>
              </div>
            </div>

            {/* Stats strip */}
            <dl className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {FEST.stats.map((s, i) => (
                <div
                  key={s.label}
                  className={`border-4 border-black bg-white px-3 py-2.5 text-center shadow-neo-sm transition-transform duration-100 hover:-translate-y-0.5 ${
                    i % 2 === 0 ? "-rotate-1" : "rotate-1"
                  }`}
                >
                  <dt className="order-2 text-[10px] sm:text-xs font-black uppercase tracking-widest text-black/70">
                    {s.label}
                  </dt>
                  <dd className="text-2xl sm:text-3xl font-black tracking-tighter text-black">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Right — Clean Logo Showcase (Desktop only, hidden on mobile) */}
          <div className="relative hidden items-center justify-center lg:col-span-5 lg:flex">
            <div className="group relative w-full max-w-[400px]">
              {/* Neo-brutalist backdrop layers */}
              <div
                className="absolute -inset-3 rotate-3 border-4 border-black bg-neo-secondary shadow-neo-xl transition-transform duration-300 group-hover:rotate-1 group-hover:scale-[1.02]"
                aria-hidden
              />
              <div
                className="absolute -inset-3 -rotate-2 border-4 border-black bg-neo-accent opacity-30"
                aria-hidden
              />

              {/* Main clean card container */}
              <div className="relative flex items-center justify-center overflow-hidden border-4 border-black bg-white p-6 sm:p-8 shadow-neo transition-transform duration-300 group-hover:-translate-y-1.5">
                {/* Clean halftone pattern background */}
                <div className="bg-halftone absolute inset-0 opacity-20" aria-hidden />

                {/* Glow aura */}
                <div
                  className="absolute h-56 w-56 rounded-full bg-neo-secondary/40 blur-2xl filter"
                  aria-hidden
                />

                {/* The Clean Logo */}
                <div className="relative z-10 flex w-full items-center justify-center py-2">
                  <Image
                    src="/pulse-logo.png"
                    alt="PULSE 2026 Logo"
                    width={380}
                    height={380}
                    unoptimized
                    priority
                    className="relative z-10 h-auto w-full max-w-[340px] object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.12)] transition-transform duration-300 group-hover:scale-105"
                  />
                </div>
              </div>

              {/* Subtle accent star */}
              <Star
                className="animate-spin-slow absolute -bottom-5 -right-5 h-12 w-12 fill-neo-accent stroke-black"
                strokeWidth={2}
                aria-hidden
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
