"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Train,
  Bus,
  Car,
  Plane,
  MapPin,
  Lightbulb,
  ArrowRight,
  Copy,
  Check,
  Navigation,
  Compass,
  Sparkles,
  ExternalLink,
  Milestone,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { ButtonLink } from "@/components/ui/Button";
import { ROUTES, LANDMARKS } from "@/lib/data";

const MODE_ICON = {
  metro: Train,
  cab: Car,
  bus: Bus,
  train: Train,
  flight: Plane,
};

const MODE_ACCENT = {
  metro: "t-halftone",
  cab: "bg-neo-secondary",
  bus: "bg-ink-3",
  train: "bg-[#5c1a10]",
  flight: "bg-neo-accent",
};

export default function ReachPage() {
  const [copied, setCopied] = useState(false);
  const fullAddress = "AIIMS Quadrangle, Sri Aurobindo Marg, Ansari Nagar, New Delhi – 110029";

  function copyAddress() {
    navigator.clipboard.writeText(fullAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  }

  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    "AIIMS Quadrangle, Sri Aurobindo Marg, Ansari Nagar, New Delhi 110029"
  )}`;

  return (
    <>
      <PageHeader
        kicker="Campus Transit & Navigation"
        title="How to Reach"
        accent="AIIMS"
        description="Getting to AIIMS New Delhi for TARANG — Yellow & Pink Line metros, direct cab drop-offs, inter-state bus hubs, railway stations, and airport connections."
      />

      {/* Main Destination Showcase Banner */}
      <section className="relative overflow-hidden border-b-8 border-black bg-black py-10 text-white">
        <div className="absolute inset-0 bg-[radial-gradient(#d4190f_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />
        <div className="relative mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 sm:px-6 lg:flex-row lg:items-center">
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center border-4 border-white bg-neo-accent text-black shadow-neo-white">
              <MapPin className="h-8 w-8" strokeWidth={3} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black uppercase tracking-[0.25em] text-neo-secondary">
                  Official Fest Destination
                </span>
                <span className="border border-white/40 bg-zinc-900 px-2 py-0.5 text-[11px] font-mono font-bold text-white">
                  TARANG 2026
                </span>
              </div>
              <h2 className="mt-1 text-2xl font-black uppercase tracking-tight sm:text-3xl md:text-4xl text-white">
                {fullAddress}
              </h2>
              <p className="mt-1 text-sm font-bold text-white/80">
                CR Desk &amp; Registration: Near Swimming Pool, AIIMS Campus
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* <Link
              href="/map"
              className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-2 border-4 border-white bg-neo-secondary px-5 py-3 text-sm font-black uppercase tracking-wider text-black shadow-neo-white transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px]"
            >
              <Compass className="h-4 w-4 text-black" strokeWidth={2.5} />
              <span>Campus Venue Map</span>
            </Link> */}

            <button
              type="button"
              onClick={copyAddress}
              className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-2 border-4 border-white bg-white px-5 py-3 text-sm font-black uppercase tracking-wider text-black shadow-neo-white transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px]"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-black" strokeWidth={3} />
                  <span>Address Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4 text-black" strokeWidth={2.5} />
                  <span>Copy Address</span>
                </>
              )}
            </button>

            <a
              href={gmapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex flex-1 sm:flex-initial items-center justify-center gap-2 border-4 border-white bg-neo-accent px-5 py-3 text-sm font-black uppercase tracking-wider text-black shadow-neo-white transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px]"
            >
              <Navigation className="h-4 w-4" />
              <span>Open in Maps</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </section>

      {/* Transit Quick Stats Strip */}
      <section className="border-b-4 border-black bg-neo-secondary py-3 text-black">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 sm:px-6 text-xs font-black uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-yellow-400 border border-black" />
            <span>AIIMS Metro: Gate 1 &amp; 2</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-pink-400 border border-black" />
            <span>South Ext Metro: Gate 3 &amp; 4</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-blue-400 border border-black" />
            <span>Cabs: AIIMS Quadrangle Drop</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-emerald-400 border border-black" />
            <span>Buses: Kashmere Gate / Dhaula Kuan</span>
          </div>
        </div>
      </section>

      {/* Transit Cards Grid */}
      <section className="bg-neo-cream py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b-4 border-black pb-6">
            <div>
              <span className="border-2 border-black bg-neo-accent px-3 py-1 text-xs font-black uppercase tracking-wider">
                Transit Guide
              </span>
              <h2 className="mt-3 text-3xl font-black uppercase tracking-tight sm:text-4xl md:text-5xl">
                Choose Your Mode of Travel
              </h2>
            </div>
            <p className="max-w-md text-sm font-bold text-black/70">
              Multiple seamless transit links deliver you right at AIIMS gates. Check the gate exit numbers for quickest festival access.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
            {ROUTES.map((route, i) => {
              const Icon = MODE_ICON[route.mode] || Train;
              const headerAccent = MODE_ACCENT[route.mode] || "bg-neo-secondary";

              return (
                <article
                  key={route.id}
                  className={`flex flex-col border-4 border-black bg-white dark:bg-neo-card text-black dark:text-white shadow-neo transition-all duration-200 hover:-translate-y-1 hover:shadow-neo-lg ${
                    i % 2 === 0 ? "lg:-rotate-0.5" : "lg:rotate-0.5"
                  }`}
                >
                  {/* Card Header */}
                  <div className={`flex flex-wrap items-center justify-between gap-4 border-b-4 border-black p-5 sm:p-6 ${headerAccent}`}>
                    <div className="flex items-center gap-3.5">
                      <div className="flex h-13 w-13 shrink-0 items-center justify-center border-4 border-black bg-white shadow-neo-sm">
                        <Icon className="h-6 w-6 text-black" strokeWidth={2.8} />
                      </div>
                      <div>
                        <h3 className="text-2xl font-black uppercase tracking-tight text-black">
                          {route.title}
                        </h3>
                        <p className="text-xs font-bold text-black/80">{route.summary}</p>
                      </div>
                    </div>

                    {route.lineOrHub && (
                      <span className={`border-2 px-3 py-1 text-xs font-black uppercase tracking-wider shadow-neo-xs ${route.badgeColor || "bg-white text-black border-black"}`}>
                        {route.lineOrHub}
                      </span>
                    )}
                  </div>

                  {/* Gate / Drop-off Callout Badge */}
                  {route.gateExit && (
                    <div className="border-b-2 border-black bg-black px-6 py-2.5 text-xs font-black uppercase tracking-wider text-neo-secondary flex items-center gap-2">
                      <Milestone className="h-4 w-4 shrink-0 text-neo-accent" />
                      <span>{route.gateExit}</span>
                    </div>
                  )}

                  {/* Steps Content */}
                  <div className="flex flex-1 flex-col justify-between gap-6 p-6 sm:p-7 text-black dark:text-white">
                    <ol className="space-y-3.5">
                      {route.steps.map((step, si) => (
                        <li key={si} className="flex items-start gap-3.5">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-black bg-neo-accent text-xs font-black text-black shadow-neo-xs">
                            {si + 1}
                          </span>
                          <span className="text-sm font-bold leading-relaxed text-black/90 dark:text-zinc-300 pt-0.5">
                            {step}
                          </span>
                        </li>
                      ))}
                    </ol>

                    {/* Tip Bar */}
                    <div className="mt-auto flex items-start gap-3 border-4 border-black bg-neo-cream dark:bg-neo-surface p-4 shadow-neo-xs">
                      <Lightbulb className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={3} />
                      <p className="text-xs font-bold leading-snug text-black/90 dark:text-zinc-300">
                        <strong className="uppercase tracking-wider text-black dark:text-white">Pro Tip: </strong>
                        {route.tip}
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {/* CR Desk & Physical Collection Callout */}
          <div className="mt-16 border-8 border-black bg-neo-accent p-6 sm:p-8 md:p-10 text-black shadow-neo-lg">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div className="space-y-2">
                <div className="inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-1 text-xs font-black uppercase tracking-wider text-black">
                  <Sparkles className="h-4 w-4 text-black" />
                  Card Collection Point
                </div>
                <h3 className="text-3xl font-black uppercase tracking-tight text-black sm:text-4xl">
                  Central Registration (CR) Desk
                </h3>
                <p className="max-w-2xl text-base font-bold text-black/85">
                  Collect your physical <strong>BR Card &amp; Delegate Card</strong> on festival days at the CR Desk located <strong>near the Swimming Pool, AIIMS Campus</strong>.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <ButtonLink href="/basic-card" variant="secondary">
                  Get BR Card First
                </ButtonLink>
                <ButtonLink href="/delegate-pass" variant="dark">
                  Pro Shows Delegate Card
                </ButtonLink>
              </div>
            </div>
          </div>

          {/* Landmarks & First-Time Visitor Grid */}
          <div className="mt-12 grid gap-8 lg:grid-cols-12">
            {/* Nearby Landmarks */}
            <div className="lg:col-span-6 border-8 border-black bg-white dark:bg-neo-card text-black dark:text-white p-8 shadow-neo-lg">
              <div className="flex items-center gap-3 border-b-4 border-black pb-4 mb-6">
                <Compass className="h-7 w-7 text-black dark:text-white" strokeWidth={2.5} />
                <h3 className="text-2xl font-black uppercase tracking-tight sm:text-3xl text-black dark:text-white">
                  Key Campus Landmarks
                </h3>
              </div>
              <ul className="space-y-3.5">
                {LANDMARKS.map((landmark, idx) => (
                  <li key={idx} className="flex items-center gap-3 border-2 border-black bg-neo-cream dark:bg-neo-surface text-black dark:text-white p-3 shadow-neo-xs font-bold text-sm">
                    <ArrowRight className="h-4 w-4 shrink-0 text-neo-accent" strokeWidth={3} />
                    <span>{landmark}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* First Time Advice Card */}
            <div className="lg:col-span-6 flex flex-col justify-between border-8 border-black bg-black p-8 text-white shadow-neo-lg">
              <div>
                <span className="border-2 border-white bg-neo-secondary px-3 py-1 text-xs font-black uppercase tracking-wider text-black">
                  Campus Arrival FAQ
                </span>
                <h3 className="mt-4 text-3xl font-black uppercase tracking-tight text-white sm:text-4xl">
                  First Time at AIIMS?
                </h3>
                <p className="mt-4 text-base font-bold leading-relaxed text-white/85">
                  Tell any cab, auto, or bus conductor <strong>&quot;AIIMS Quadrangle, Ansari Nagar&quot;</strong> — it is one of the most recognizable landmarks in the capital.
                </p>
                <p className="mt-3 text-sm font-bold text-neo-secondary leading-relaxed">
                  Inside campus, look for the neon yellow TARANG signage and student coordinators at Gate 1 and Gate 2 who will direct you straight to the venues.
                </p>
              </div>

              <div className="mt-8 pt-6 border-t-2 border-white/20 flex flex-wrap items-center gap-4">
                <ButtonLink href="/ask" variant="secondary">
                  Have Questions? Ask Help Desk
                </ButtonLink>
                <ButtonLink href="/events" variant="primary">
                  Explore Events Schedule
                </ButtonLink>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Marquee
        items={[
          "AIIMS Metro (Yellow Line) — Exit Gate 1 & 2",
          "South Extension Metro (Pink Line) — Exit Gate 3 & 4",
          "Cab Destination: AIIMS Quadrangle, Sri Aurobindo Marg",
          "CR Desk: Near Swimming Pool, AIIMS Campus",
          "Airport Express + Yellow Line to AIIMS",
          "Buses: Kashmere Gate & Dhaula Kuan Hubs",
        ]}
        variant="black"
      />
    </>
  );
}

