"use client";

import Link from "next/link";
import { useRef } from "react";
import { SectionHead } from "./SectionHead";
import { Reveal } from "./Reveal";
import { range, useScene } from "./motion";

const STEPS = [
  {
    title: "Get your pass",
    body: "One Pronite Pass: both headline nights, campus access for the whole fest, and every competition.",
    href: "#passes",
    cta: "Compare passes",
  },
  {
    title: "Register",
    body: "Enter solo or bring your college squad. Confirmation lands in your dashboard instantly.",
    href: "/events",
    cta: "Browse events",
  },
  {
    title: "Find us",
    body: "NIT Patna, Ashok Rajpath — on the Ganga, behind Gandhi Ghat. About 8 km from Patna Junction.",
    href: "/reach",
    cta: "How to reach",
  },
  {
    title: "Ride the wave",
    body: "Two days on the floor, two nights on the main stage. Show your gate QR and you’re in.",
    href: "/schedule",
    cta: "Full schedule",
  },
];

/** Node positions along the wave, as fractions of the 1000-wide viewBox. */
const NODES = [0.125, 0.375, 0.625, 0.875];
const WAVE = "M0 60 C 62 10, 125 10, 125 60 S 250 110, 375 60 S 500 10, 625 60 S 750 110, 875 60 S 1000 10, 1000 40";

/** Four steps strung on a single wave that draws itself as you scroll. */
export default function Journey() {
  const root = useRef<HTMLElement>(null);
  const path = useRef<SVGPathElement>(null);
  const steps = useRef<HTMLLIElement[]>([]);

  useScene(root, () => {
    const svg = path.current;
    if (!svg) return;
    const r = svg.getBoundingClientRect();
    const vh = window.innerHeight;
    const p = range(vh * 0.85 - r.top, 0, vh * 0.55);
    svg.style.strokeDashoffset = String(1 - p);
    steps.current.forEach((s, i) => {
      s.dataset.lit = String(p >= NODES[i] - 0.02);
    });
  });

  return (
    <section ref={root} className="relative px-6 py-32 md:px-12 md:py-44" aria-labelledby="journey-title">
      <div className="mx-auto max-w-[1400px]">
        <SectionHead
          index="06"
          label="Your Tarang"
          id="journey-title"
          title={
            <>
              Four steps to <span className="t-cut-red">the front row.</span>
            </>
          }
        />

        <div className="relative mt-20 md:mt-28">
          <svg viewBox="0 0 1000 120" preserveAspectRatio="none" className="absolute inset-x-0 top-0 hidden h-[120px] w-full lg:block" aria-hidden>
            <path d={WAVE} fill="none" stroke="rgba(244,234,200,0.12)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <path
              ref={path}
              d={WAVE}
              fill="none"
              stroke="var(--color-signal)"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
              pathLength={1}
              strokeDasharray="1"
              style={{ strokeDashoffset: 1 }}
            />
          </svg>

          <ol className="grid gap-12 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
            {STEPS.map((s, i) => (
              <li
                key={s.title}
                ref={(el) => {
                  if (el) steps.current[i] = el;
                }}
                data-lit="false"
                className="group/s relative"
              >
                <Reveal delay={i * 110} className="h-full">
                  <Link href={s.href} className="group flex h-full flex-col">
                    <span className="relative mx-0 grid h-[120px] place-items-center lg:mx-auto">
                      <span className="t-display grid h-20 w-20 place-items-center rounded-full border-[3px] border-bone/25 bg-ink text-3xl text-bone/30 transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-data-[lit=true]/s:scale-110 group-data-[lit=true]/s:border-bone group-data-[lit=true]/s:bg-blood group-data-[lit=true]/s:text-bone">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </span>
                    <h3 className="t-display mt-8 text-[2.1rem] leading-[0.95] lg:text-center">{s.title}</h3>
                    <p className="mt-4 text-[0.95rem] leading-relaxed text-bone/60 lg:text-center">{s.body}</p>
                    <span className="t-label mt-6 flex items-center gap-2 text-bone/70 group-hover:text-bone lg:justify-center">
                      {s.cta} <span className="transition-transform duration-500 group-hover:translate-x-1">→</span>
                    </span>
                  </Link>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
