import type { Metadata } from "next";
import Image from "next/image";
import { PageHeader } from "@/components/ui/PageHeader";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Marquee } from "@/components/ui/Marquee";
import { ButtonLink } from "@/components/ui/Button";
import { FEST } from "@/lib/data";

export const metadata: Metadata = {
  title: "About Tarang & NIT Patna",
  description: `TARANG is the cultural festival of ${FEST.collegeFull} — five pronites and five days of music, dance, theatre and competitions on the banks of the Ganga.`,
};

/** Institute milestones — from NIT Patna’s public record. */
const MILESTONES = [
  { value: "1886", label: "Begins as a pleaders’ survey training school in Patna" },
  { value: "1924", label: "Becomes Bihar College of Engineering" },
  { value: "2004", label: "Renamed National Institute of Technology Patna" },
  { value: "2007", label: "Declared an Institute of National Importance" },
];

const PILLARS = [
  {
    title: "Five pronites",
    body: "Every evening ends on the main stage. One pass — the Pronite Pass — gets you into all five.",
  },
  {
    title: "Every stage",
    body: "Music, dance, dramatics, fine arts, literary, sports, tech & quiz and informals — eight arenas, open to every college.",
  },
  {
    title: "One campus",
    body: "Ashok Rajpath, on the south bank of the Ganga. Five days where the timetable takes a back seat.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHeader
        kicker="The festival & the institute"
        title="About"
        accent="Tarang"
        description={`TARANG is the cultural festival of ${FEST.collegeFull}. ${FEST.tagline} Five days, five pronites, one wave.`}
      />

      {/* The word */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
        <div className="grid items-center gap-12 lg:grid-cols-12">
          <div className="kit-rise lg:col-span-5">
            <p aria-hidden className="t-deva t-cut-red select-none text-[clamp(6rem,18vw,14rem)] leading-[1.2]">
              तरंग
            </p>
            <p className="t-label mt-2 text-bone/55">/tə·ˈrəŋ/ · noun · Sanskrit — a wave</p>
          </div>
          <div className="lg:col-span-7">
            <SectionHeading kicker="The festival" title="Mute the" accent="mundane." />
            <div className="kit-rise space-y-5 text-lg leading-relaxed text-bone/75">
              <p>
                A <em>tarang</em> is a wave — a ripple that starts small and carries everyone with it. That is the idea
                behind the festival: for five days, the routine goes quiet and the campus turns up the volume.
              </p>
              <p>
                Competitions run through the day across eight arenas. Every evening, the main stage takes over for a
                pronite. Students from every college are welcome — on stage, in the crowd, or both.
              </p>
            </div>
          </div>
        </div>

        <ul className="mt-20 grid gap-px overflow-hidden rounded-[6px] border-[3px] border-black bg-bone/15 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <li key={p.title} className="kit-rise bg-ink p-8 md:p-10">
              <span className="t-display text-6xl leading-none text-transparent [-webkit-text-stroke:1.5px_var(--color-signal)]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="t-display mt-6 text-3xl text-bone">{p.title}</h3>
              <p className="mt-3 leading-relaxed text-bone/65">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* The institute */}
      <section className="t-halftone relative isolate overflow-hidden border-y-[3px] border-ink">
        <div aria-hidden className="pointer-events-none absolute -bottom-[30%] -left-[10%] w-[min(90vw,760px)] opacity-80">
          <Image src="/tarang/hands-bottom.webp" alt="" width={1402} height={848} sizes="760px" className="h-auto w-full rotate-[8deg]" />
        </div>
        <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
          <div className="grid gap-12 lg:grid-cols-12">
            <div className="lg:col-span-6 lg:col-start-7">
              <p className="t-label text-bone/80">The institute</p>
              <h2 className="t-display t-cut mt-5 text-[clamp(2.8rem,7vw,6rem)] leading-[0.9]">NIT Patna</h2>
              <div className="mt-8 space-y-5 rounded-[6px] bg-ink/80 p-6 text-lg leading-relaxed text-bone/85 backdrop-blur-sm md:p-8">
                <p>
                  One of India’s oldest engineering institutions, {FEST.collegeFull} traces its roots to 1886. Its
                  campus runs along Ashok Rajpath on the south bank of the Ganga, with a second campus coming up at
                  Bihta.
                </p>
                <p>
                  Today it is an Institute of National Importance with departments across architecture, engineering,
                  the sciences and the humanities — and every September, it is home to TARANG.
                </p>
              </div>
            </div>
          </div>

          <dl className="mt-16 grid grid-cols-2 gap-4 md:grid-cols-4">
            {MILESTONES.map((m) => (
              <div key={m.value} className="kit-rise rounded-[6px] border-[3px] border-black bg-bone p-5 text-ink shadow-neo md:p-6">
                <dt className="t-display text-4xl md:text-5xl">{m.value}</dt>
                <dd className="mt-3 text-sm font-semibold leading-snug text-ink/75">{m.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Invitation */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
        <div className="kit-rise flex flex-col items-start justify-between gap-8 rounded-[6px] border-[3px] border-black bg-neo-card p-8 shadow-neo-lg md:flex-row md:items-center md:p-12">
          <div>
            <p className="t-label text-bone/55">{FEST.dates}</p>
            <h2 className="t-display mt-4 text-[clamp(2.2rem,5vw,4rem)] leading-[0.92] text-bone">
              See you on <span className="t-cut-red">the wave.</span>
            </h2>
            <p className="mt-3 text-bone/65">{FEST.venue}</p>
          </div>
          <div className="flex flex-wrap gap-4">
            <ButtonLink href="/pronite-pass">Get your Pronite Pass</ButtonLink>
            <ButtonLink href="/reach" variant="outline">
              How to reach
            </ButtonLink>
          </div>
        </div>
      </section>

      <Marquee items={["Mute the mundane", "NIT Patna", "Five pronites", "Sept 2026", "One wave"]} variant="accent" />
    </>
  );
}
