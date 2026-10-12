import type { Metadata } from "next";
import Image from "next/image";
import {
  HeartPulse,
  Landmark,
  Trophy,
  Star,
  Sparkles,
  MapPin,
  Flame,
  Award,
  Globe,
  GraduationCap,
  Quote,
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Marquee } from "@/components/ui/Marquee";
import { ButtonLink } from "@/components/ui/Button";
import { FEST, PULSE_VENUES } from "@/lib/data";

export const metadata: Metadata = {
  title: "About AIIMS & TARANG — The Legacy",
  description:
    "The story of AIIMS New Delhi and TARANG — South Asia's largest medical college cultural, literary, and sports festival since 1973.",
};

const AIIMS_STATS = [
  {
    icon: Award,
    stat: "Rank #1",
    label: "Medical Institution in India since Inception",
    accent: "bg-neo-accent text-black",
  },
  {
    icon: Globe,
    stat: "Rank #6",
    label: "Globally in Brand Finance Academic Medical Brands",
    accent: "bg-neo-secondary text-black",
  },
  {
    icon: GraduationCap,
    stat: "1956",
    label: "Established as India's Apex Institute",
    accent: "bg-white text-black dark:bg-[#121214] dark:text-white",
  },
  {
    icon: Landmark,
    stat: "42",
    label: "Teaching & Research Disciplines",
    accent: "bg-neo-muted text-black",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHeader
        kicker="The Institution & The Festival"
        title="ABOUT"
        accent="AIIMS & TARANG"
        description="South Asia’s largest medical college cultural, literary, and sports festival — envisioned, created, and managed entirely by the AIIMS Student Association."
      />

      {/* Quote Banner */}
      <section className="border-b-8 border-black bg-black py-8 text-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col md:flex-row items-center gap-6 border-4 border-white bg-zinc-950 p-6 sm:p-8 shadow-neo-white">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center border-2 border-white bg-neo-accent text-black shadow-neo-xs">
              <Quote className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xl sm:text-2xl md:text-3xl font-black uppercase tracking-tight text-neo-secondary">
                “FIVE days, one beat, infinite memories where AIIMS New Delhi ignites and the ultimate carnival explodes!”
              </p>
              <p className="mt-2 text-xs font-black uppercase tracking-widest text-white/70">
                — AIIMS Student Association (ASA)
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 1: About AIIMS New Delhi */}
      <section className="border-b-8 border-black bg-neo-cream py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-12 items-center">
            {/* Left Story */}
            <div className="lg:col-span-7 space-y-6">
              <div>
                <span className="border-2 border-black bg-neo-accent px-3 py-1 text-xs font-black uppercase tracking-wider text-black">
                  Premier Medical Institution
                </span>
                <h2 className="mt-3 text-4xl font-black uppercase tracking-tight sm:text-5xl text-black dark:text-white">
                  About AIIMS New Delhi
                </h2>
              </div>

              <div className="space-y-4 text-base sm:text-lg font-bold leading-relaxed text-black/85 dark:text-zinc-300">
                <p>
                  Established in 1956, <strong>All India Institute of Medical Sciences (AIIMS) New Delhi</strong> is India’s premier institution for medical education, healthcare, and pioneering research.
                </p>
                <p>
                  <strong>Ranked #1 among Medical Institutions in India</strong> since its inception, AIIMS continues to set global benchmarks in medicine, clinical excellence, and biomedical innovation. AIIMS holds a prominent global position, <strong>ranking 6th globally</strong> in the prestigious Brand Finance Global Top Academic Medical Brands report.
                </p>
                <p>
                  With <strong>42 teaching and research disciplines</strong>, it is home to some of the country’s brightest medical minds. For generations of medical aspirants, AIIMS has been far more than a college — <strong>it has been a dream</strong>.
                </p>
                <p className="border-l-4 border-neo-accent bg-white dark:bg-[#121214] text-black dark:text-white p-4 shadow-neo-sm">
                  And once a year, that dream comes alive as <strong>TARANG</strong>, bringing together the brightest medical minds from across the country.
                  <br />
                  <span className="mt-1 block text-sm font-black uppercase tracking-wider text-neo-accent">
                    Come to AIIMS. Experience the legacy. Be a part of TARANG.
                  </span>
                </p>
              </div>

              <div className="pt-2 flex flex-wrap items-center gap-4">
                <ButtonLink href="/reach" variant="primary">
                  How to Reach Campus
                </ButtonLink>
                <ButtonLink href="/events" variant="secondary">
                  Explore Events Lineup
                </ButtonLink>
              </div>
            </div>

            {/* Right: AIIMS Stat Cards */}
            <div className="lg:col-span-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {AIIMS_STATS.map((item, idx) => {
                const Icon = item.icon;
                return (
                  <div
                    key={idx}
                    className={`border-4 border-black p-6 shadow-neo transition-transform hover:-translate-y-1 ${item.accent}`}
                  >
                    <div className="flex h-12 w-12 items-center justify-center border-2 border-black bg-white dark:bg-[#121214] shadow-neo-xs">
                      <Icon className="h-6 w-6 text-black dark:text-white" strokeWidth={2.5} />
                    </div>
                    <p className="mt-4 font-mono text-3xl font-black tracking-tight text-black dark:text-white">
                      {item.stat}
                    </p>
                    <p className="mt-1 text-xs font-black uppercase leading-snug text-black/80 dark:text-zinc-300">
                      {item.label}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: About TARANG & ASA */}
      <section className="border-b-8 border-black bg-neo-secondary dark:bg-[#000000] py-16 sm:py-24 transition-colors">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-12 items-center">
            {/* Right / Top Card on Mobile */}
            <div className="lg:col-span-5 order-2 lg:order-1">
              <div className="border-8 border-black bg-white dark:bg-[#121214] text-black dark:text-white p-8 shadow-neo-xl">
                <div className="flex items-center gap-4">
                  <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden border-4 border-black bg-neo-secondary p-1 shadow-neo-xs">
                    <Image
                      src="/pulse-logo.png"
                      alt="TARANG Mascot Logo"
                      width={56}
                      height={56}
                      unoptimized
                      className="h-full w-full object-contain"
                    />
                  </div>
                  <div>
                    <span className="border-2 border-black bg-neo-accent px-2 py-0.5 text-[10px] font-black uppercase text-black shadow-neo-xs">
                      Official Symbol
                    </span>
                    <h3 className="text-2xl font-black uppercase tracking-tight text-black dark:text-white">
                      The Tarang Fox
                    </h3>
                  </div>
                </div>
                <p className="mt-4 text-sm font-bold leading-relaxed text-black/80 dark:text-zinc-300">
                  Envisioned, created, and managed entirely by the <strong>AIIMS Student Association (ASA)</strong> — the official undergraduate student body of AIIMS New Delhi.
                </p>
                <div className="mt-6 space-y-2.5 border-t-2 border-black/20 dark:border-white/15 pt-4 text-xs font-bold">
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 fill-neo-accent text-black" />
                    <span>South Asia&apos;s Largest Medical College Fest</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 fill-neo-accent text-black" />
                    <span>Over 450 Participating Institutions</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Star className="h-4 w-4 fill-neo-accent text-black" />
                    <span>5 Decades of Enduring Heritage (Est. 1973)</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Left Story Text */}
            <div className="lg:col-span-7 order-1 lg:order-2 space-y-6">
              <div>
                <span className="border-2 border-black bg-white dark:bg-[#121214] text-black dark:text-white px-3 py-1 text-xs font-black uppercase tracking-wider">
                  The Story of TARANG
                </span>
                <h2 className="mt-3 text-4xl font-black uppercase tracking-tight sm:text-5xl text-black dark:text-white">
                  Five Decades of Tarang
                </h2>
              </div>

              <div className="space-y-4 text-base sm:text-lg font-bold leading-relaxed text-black/85 dark:text-zinc-300">
                <p>
                  <strong>TARANG</strong> is the cultural heartbeat of student life at AIIMS, envisioned, created, and managed entirely by the <strong>AIIMS Student Association (ASA)</strong> — the official undergraduate student body of AIIMS New Delhi.
                </p>
                <p>
                  Far more than an event, it is an enduring legacy that unites thousands of students, alumni, and delegates in a shared celebration of talent, sportsmanship, creativity, and community.
                </p>
                <p>
                  What began in <strong>1973</strong> as a modest sports meet has grown over five decades into South Asia’s largest medical college cultural, literary, and sports festival, attracting over <strong>450 participating institutions</strong> from across India and abroad. Year after year, TARANG transforms the AIIMS campus into a sprawling arena of competitions, exhibitions, performances, and festivities.
                </p>
                <p>
                  During TARANG, the entire AIIMS campus transforms into an electric arena of activity. From sports fields roaring with competitive spirit and packed halls hosting intense intellectual showdowns, to open-air stages pulsing with music late into the night, creativity flourishes and lifelong friendships are forged in every heartbeat of the festival.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Section 3: Tarang Key Venues */}
      <section className="border-b-8 border-black bg-neo-muted dark:bg-[#000000] py-16 sm:py-24 transition-colors">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="mb-12 flex flex-col md:flex-row md:items-end md:justify-between gap-4 border-b-4 border-black pb-6">
            <div>
              <span className="border-2 border-black bg-neo-accent px-3 py-1 text-xs font-black uppercase tracking-wider text-black">
                Festival Grounds
              </span>
              <h2 className="mt-3 text-3xl font-black uppercase tracking-tight sm:text-4xl md:text-5xl text-black dark:text-white">
                Tarang Key Venues
              </h2>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <p className="max-w-md text-sm font-bold text-black/75 dark:text-zinc-300">
                Explore the iconic hubs, grand stages, auditoriums, and sports complexes across the 100-acre AIIMS campus.
              </p>
              <ButtonLink href="/reach" variant="primary">
                How to Reach →
              </ButtonLink>
            </div>
          </div>

          {/* Venues Grid */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {PULSE_VENUES.map((venue, idx) => (
              <div
                key={venue.id}
                className={`flex flex-col justify-between border-4 border-black bg-white dark:bg-[#121214] text-black dark:text-white p-6 shadow-neo transition-all duration-200 hover:-translate-y-1.5 hover:shadow-neo-lg ${
                  idx === 0 ? "sm:col-span-2 lg:col-span-2" : ""
                }`}
              >
                <div>
                  <div className="flex items-center justify-between border-b-2 border-black/15 pb-3">
                    <span className="border border-black bg-neo-secondary px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-black">
                      {venue.tag}
                    </span>
                    <MapPin className="h-4 w-4" />
                  </div>
                  <h3 className="mt-3 text-2xl font-black uppercase tracking-tight text-black dark:text-white">
                    {venue.name}
                  </h3>
                  <p className="text-xs font-black uppercase tracking-wide text-neo-accent">
                    {venue.category}
                  </p>
                  <p className="mt-3 text-xs font-bold leading-relaxed text-black/80 dark:text-zinc-300">
                    {venue.description}
                  </p>
                </div>

                <div className="mt-6 border-t-2 border-black/10 dark:border-white/10 pt-3 flex items-center justify-between text-[11px] font-bold opacity-60">
                  <span>AIIMS Campus</span>
                  <span className="font-mono">Venue #{idx + 1}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Marquee
        items={[
          "AIIMS Est. 1956",
          "Rank #1 Medical Institution in India",
          "Rank #6 Globally (Brand Finance)",
          "TARANG Est. 1973",
          "AIIMS Student Association (ASA)",
          "450+ Institutions",
        ]}
        variant="black"
      />
    </>
  );
}
