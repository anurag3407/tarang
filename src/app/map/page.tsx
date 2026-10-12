import type { Metadata } from "next";
import Link from "next/link";
import {
  MapPin,
  Compass,
  Navigation,
  Milestone,
  Train,
  Car,
  Phone,
  ShieldAlert,
  Sparkles,
  Award,
  Layers,
  ArrowRight,
  ExternalLink,
  Footprints,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { ButtonLink } from "@/components/ui/Button";
import VenueMap from "@/components/map/VenueMap";
import {
  CAMPUS_GATES,
  CAMPUS_ROADS,
  CAMPUS_BUILDINGS,
} from "@/lib/map-data";
import { FEST } from "@/lib/data";

export const metadata: Metadata = {
  title: "Interactive Campus Venue Map — AIIMS PULSE 2026",
  description:
    "Explore the official interactive venue map of AIIMS New Delhi for PULSE 2026. Find Quadrangle, JL Auditorium, Gymkhana, CR Desk, internal road numbers 1–6, and gates 1–6 with ease.",
};

const MAP_STATS = [
  { label: "Campus Grounds", value: "100+ Acres", accent: "bg-neo-secondary" },
  { label: "Entry Gates", value: "6 Gates", accent: "bg-neo-accent" },
  { label: "Internal Roads", value: "Roads 1–6", accent: "bg-neo-muted" },
  { label: "Active Venues", value: "14 Hubs", accent: "bg-white" },
];

export default function VenueMapPage() {
  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    "AIIMS Quadrangle, Sri Aurobindo Marg, Ansari Nagar, New Delhi 110029"
  )}`;

  return (
    <>
      <PageHeader
        kicker="Campus Grounds & Wayfinding"
        title="VENUE"
        accent="MAP"
        description="Navigate the 100-acre AIIMS New Delhi campus with ease. Use internal road numbers (Road 1–6), numbered gates (Gate 1–6), and landmark wayfinding without GPS."
      />

      {/* Quick Action & Stats Strip */}
      <section className="border-b-8 border-black bg-black py-8 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 flex-1">
              {MAP_STATS.map((st, idx) => (
                <div
                  key={idx}
                  className={`border-4 border-white p-4 text-black shadow-neo-white ${st.accent}`}
                >
                  <p className="text-[11px] font-black uppercase tracking-wider text-black/70">
                    {st.label}
                  </p>
                  <p className="mt-1 text-2xl font-black uppercase tracking-tight sm:text-3xl">
                    {st.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <a
                href={gmapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 border-4 border-white bg-neo-accent px-5 py-3 text-sm font-black uppercase tracking-wider text-black shadow-neo-white transition-transform hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px]"
              >
                <Navigation className="h-4 w-4" />
                <span>Open Google Maps</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <ButtonLink href="/reach" variant="secondary">
                Transit Guide &amp; Metros →
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      {/* Main Interactive Map Section (Disabled/Commented) */}
      {/* <section className="border-b-8 border-black bg-neo-cream py-12 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b-4 border-black pb-6">
            <div>
              <span className="border-2 border-black bg-neo-accent px-3 py-1 text-xs font-black uppercase tracking-wider">
                Interactive Campus Vector
              </span>
              <h2 className="mt-3 text-3xl font-black uppercase tracking-tight sm:text-4xl md:text-5xl">
                AIIMS Grounds &amp; Venues
              </h2>
            </div>
            <p className="max-w-md text-sm font-bold text-black/75">
              Click any building to view hosted events and amenities. Select entry gates and roads to trace instant walking directions.
            </p>
          </div>

          <VenueMap />
        </div>
      </section> */}

      {/* Internal Road & Gate Numbering Reference Guide */}
      <section className="border-b-8 border-black bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b-4 border-black pb-6">
            <div>
              <span className="border-2 border-black bg-neo-secondary px-3 py-1 text-xs font-black uppercase tracking-wider">
                Campus Grid System
              </span>
              <h2 className="mt-3 text-3xl font-black uppercase tracking-tight sm:text-4xl">
                Internal Roads &amp; Gate Numbers
              </h2>
            </div>
            <p className="max-w-md text-sm font-bold text-black/70">
              AIIMS New Delhi campus uses clear internal road numbers and gate markings to make orientation fast and reliable.
            </p>
          </div>

          {/* Grid of Numbered Roads and Gates */}
          <div className="grid gap-8 lg:grid-cols-12">
            {/* Numbered Internal Roads (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center gap-3 border-b-4 border-black pb-3">
                <Milestone className="h-6 w-6 text-black" strokeWidth={2.5} />
                <h3 className="text-2xl font-black uppercase tracking-tight">
                  Internal Road Numbers
                </h3>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {CAMPUS_ROADS.filter((r) => r.number !== undefined).map((road) => (
                  <div
                    key={road.id}
                    className="border-4 border-black bg-neo-cream p-4 shadow-neo-xs transition-transform hover:-translate-y-0.5"
                  >
                    <div className="flex items-center justify-between border-b-2 border-black/20 pb-2">
                      <span className="border-2 border-black bg-black px-2 py-0.5 text-xs font-black text-neo-secondary">
                        {road.code}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-black/60">
                        Spine Corridor
                      </span>
                    </div>
                    <h4 className="mt-2 text-base font-black uppercase tracking-tight">
                      {road.name}
                    </h4>
                    <p className="mt-2 text-xs font-bold leading-relaxed text-black/80">
                      {road.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Numbered Campus Gates (5 cols) */}
            <div className="lg:col-span-5 space-y-4">
              <div className="flex items-center gap-3 border-b-4 border-black pb-3">
                <Compass className="h-6 w-6 text-black" strokeWidth={2.5} />
                <h3 className="text-2xl font-black uppercase tracking-tight">
                  Campus Gates &amp; Metro Links
                </h3>
              </div>

              <div className="space-y-3">
                {CAMPUS_GATES.map((gate) => (
                  <div
                    key={gate.id}
                    className="border-4 border-black bg-white p-4 shadow-neo-xs transition-transform hover:-translate-y-0.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="border-2 border-black bg-neo-accent px-2 py-0.5 text-xs font-black uppercase text-white">
                        Gate {gate.number}
                      </span>
                      {gate.metroConnection && (
                        <span className="border border-black bg-yellow-300 px-1.5 py-0.5 text-[10px] font-black uppercase flex items-center gap-1">
                          <Train className="h-3 w-3" />
                          <span>Metro Link</span>
                        </span>
                      )}
                    </div>
                    <h4 className="mt-2 text-sm font-black uppercase text-black">
                      {gate.name}
                    </h4>
                    <p className="mt-1 text-xs font-bold text-black/70">
                      {gate.street}
                    </p>
                    {gate.metroConnection && (
                      <p className="mt-1.5 text-[11px] font-bold text-black/90">
                        🚇 {gate.metroConnection}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Complete Venue Directory Cards */}
      <section className="border-b-8 border-black bg-neo-cream py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b-4 border-black pb-6">
            <div>
              <span className="border-2 border-black bg-neo-accent px-3 py-1 text-xs font-black uppercase tracking-wider">
                Grounds Directory
              </span>
              <h2 className="mt-3 text-3xl font-black uppercase tracking-tight sm:text-4xl md:text-5xl">
                All Festival Venues
              </h2>
            </div>
            <p className="max-w-md text-sm font-bold text-black/75">
              Everything happening across the 5 days of PULSE — from the grand Quadrangle stage to high-tech surgical workshops.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CAMPUS_BUILDINGS.map((venue, idx) => (
              <div
                key={venue.id}
                className="flex flex-col justify-between border-4 border-black bg-white p-6 shadow-neo transition-all duration-200 hover:-translate-y-1 hover:shadow-neo-lg"
              >
                <div>
                  <div className="flex items-center justify-between border-b-2 border-black/15 pb-3">
                    <span className="border-2 border-black bg-neo-secondary px-2 py-0.5 text-[10px] font-black uppercase tracking-wider">
                      {venue.code} · {venue.tag}
                    </span>
                    <span className="text-xs font-mono font-bold text-black/60">
                      {venue.categoryLabel}
                    </span>
                  </div>

                  <h3 className="mt-3 text-xl font-black uppercase tracking-tight text-black">
                    {venue.name}
                  </h3>

                  <div className="mt-3 flex items-center gap-2 text-xs font-black text-neo-accent">
                    <Navigation className="h-3.5 w-3.5" />
                    <span>{venue.nearestRoad}</span>
                  </div>

                  <p className="mt-3 text-xs font-bold leading-relaxed text-black/80">
                    {venue.description}
                  </p>

                  {venue.eventsHosted.length > 0 && (
                    <div className="mt-4 border-t-2 border-black/10 pt-3">
                      <span className="text-[10px] font-black uppercase tracking-wider text-black/60">
                        Key Events:
                      </span>
                      <ul className="mt-1.5 space-y-1 text-xs font-bold text-black/90">
                        {venue.eventsHosted.slice(0, 3).map((e, i) => (
                          <li key={i} className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 bg-black" />
                            <span>{e}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex items-center justify-between border-t-2 border-black/10 pt-3 text-[11px] font-bold text-black/70">
                  <span>Entry: {venue.nearestGate.split("(")[0]}</span>
                  {venue.capacity && (
                    <span className="font-mono text-black">{venue.capacity}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Central Registration (CR Desk) Banner */}
      <section className="border-b-8 border-black bg-neo-accent py-12 text-black">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 border-2 border-black bg-white px-3 py-1 text-xs font-black uppercase tracking-wider">
                <Sparkles className="h-4 w-4 text-black" />
                Physical Pass &amp; Kit Collection
              </div>
              <h3 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">
                Central Registration (CR) Desk
              </h3>
              <p className="max-w-2xl text-sm sm:text-base font-bold text-black/90">
                Collect your physical <strong>BR Card &amp; Delegate Passes</strong> on event days at the CR Desk located <strong>near the Swimming Pool, along Road No. 3 (Gymkhana Boulevard)</strong>.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <ButtonLink href="/basic-card" variant="secondary">
                Get BR Card
              </ButtonLink>
              <ButtonLink href="/delegate-pass" variant="dark">
                Get Delegate Card
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>

      <Marquee
        items={[
          "AIIMS Quadrangle Main Stage — Road No. 1",
          "CR Desk: Near Swimming Pool — Road No. 3",
          "JL Auditorium — Gate 1 Entrance",
          "Teaching Block LT1–LT4 — Gate 2 Entrance",
          "Gymkhana Stadium — Gate 4 & 5",
          "AIIMS Metro (Yellow Line) — Gate 1 & 2",
          "South Extension Metro (Pink Line) — Gate 4",
        ]}
        variant="black"
      />
    </>
  );
}
