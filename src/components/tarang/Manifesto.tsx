"use client";

import { useRef, type CSSProperties } from "react";
import { FEST } from "@/lib/data";
import { Reveal } from "./Reveal";
import { passProgress, range, useScene } from "./motion";

const DEFINITIONS = [
  "A wave; a ripple travelling through water, air, or a crowd.",
  "A surge — of sound, of feeling, of ten thousand people finding the same beat.",
  "Five days in September when the campus stops keeping time and starts keeping rhythm.",
];

const STATEMENT =
  "We built Tarang for the part of you the timetable forgot. Lab coats off. Alarms off. Phones up. The only deadline left is the next encore.";
const LOUD = new Set(["off.", "up.", "encore."]);

/** Rolls each digit up from zero like a tape counter. */
function Odometer({ value }: { value: string }) {
  let n = 0;
  return (
    <span className="inline-flex overflow-hidden leading-none" aria-label={value}>
      {Array.from(value).map((ch, i) => {
        if (!/\d/.test(ch)) {
          return (
            <span key={i} aria-hidden className="text-signal">
              {ch}
            </span>
          );
        }
        const d = Number(ch);
        const delay = n++ * 120;
        return (
          <span key={i} aria-hidden className="relative inline-block h-[1em] overflow-hidden">
            <span
              className="flex flex-col transition-transform duration-[1800ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-data-[shown=true]:[transform:translateY(calc(var(--d)*-10%))]"
              style={{ "--d": d, transitionDelay: `${delay}ms` } as CSSProperties}
            >
              {Array.from({ length: 10 }, (_, k) => (
                <span key={k} className="block h-[1em]">
                  {k}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** The word, defined — then a statement whose words light up as you read. */
export default function Manifesto() {
  const root = useRef<HTMLElement>(null);
  const deva = useRef<HTMLParagraphElement>(null);
  const statement = useRef<HTMLParagraphElement>(null);

  useScene(root, (_, el) => {
    const p = passProgress(el);
    if (deva.current) deva.current.style.transform = `translate3d(0, ${((p - 0.5) * -120).toFixed(1)}px, 0)`;

    const s = statement.current;
    if (!s) return;
    const r = s.getBoundingClientRect();
    const vh = window.innerHeight;
    const lit = range(vh * 0.85 - r.top, 0, r.height + vh * 0.35);
    const words = s.querySelectorAll<HTMLSpanElement>("[data-w]");
    const k = lit * words.length;
    words.forEach((w, i) => {
      w.style.opacity = String(0.14 + 0.86 * range(k - i, 0, 1));
    });
  });

  return (
    <section ref={root} className="relative overflow-hidden px-6 py-32 md:px-12 md:py-44" aria-labelledby="definition-title">
      <div className="mx-auto max-w-[1400px]">
        <div className="flex items-start justify-between gap-6 border-t border-bone/15 pt-5">
          <p className="t-label text-bone/50">(02) — Definition</p>
          <p className="t-label text-bone/50">/tə·ˈrəŋ/ · noun · Sanskrit</p>
        </div>

        <div className="mt-16 grid items-start gap-14 md:mt-24 md:grid-cols-12 md:gap-8">
          <div className="md:col-span-5">
            <h2 id="definition-title" className="sr-only">
              Tarang, noun: a wave
            </h2>
            <Reveal variant="wipe">
              <p ref={deva} aria-hidden className="t-deva t-cut-red select-none text-[clamp(7rem,21vw,20rem)] leading-[1.25] will-change-transform">
                तरंग
              </p>
            </Reveal>
          </div>

          <ol className="md:col-span-7 md:pt-10">
            {DEFINITIONS.map((d, i) => (
              <Reveal as="li" key={i} delay={i * 120} className="flex gap-6 border-t border-bone/12 py-7 md:gap-10 md:py-9">
                <span className="t-display mt-1 text-2xl text-signal md:text-3xl">{i + 1}.</span>
                <p
                  className={`text-[clamp(1.25rem,2.1vw,1.9rem)] leading-snug tracking-tight ${
                    i === 2 ? "text-bone" : "text-bone/70"
                  }`}
                >
                  {d}
                </p>
              </Reveal>
            ))}
          </ol>
        </div>

        <p
          ref={statement}
          className="mt-28 max-w-[22ch] text-[clamp(2.2rem,5.4vw,5.4rem)] font-medium leading-[1.02] tracking-[-0.035em] md:mt-44"
        >
          {STATEMENT.split(" ").map((w, i) => (
            <span key={i} data-w className={LOUD.has(w) ? "text-signal" : ""} style={{ opacity: 0.14 }}>
              {w}{" "}
            </span>
          ))}
        </p>

        <dl className="mt-28 grid grid-cols-2 border-t border-bone/15 md:mt-40 md:grid-cols-4">
          {FEST.stats.map((s, i) => (
            <Reveal
              key={s.label}
              variant="mask"
              delay={i * 90}
              className={`group flex flex-col gap-4 border-bone/15 py-10 pr-6 md:py-14 ${i > 0 ? "md:border-l md:pl-8" : ""} ${
                i % 2 === 1 ? "border-l pl-6" : ""
              } ${i > 1 ? "border-t md:border-t-0" : ""}`}
            >
              <dt className="t-label order-2 text-bone/45">{s.label}</dt>
              <dd className="t-display text-[clamp(3.4rem,7vw,6.5rem)]">
                <Odometer value={s.value} />
              </dd>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}
