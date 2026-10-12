"use client";

import { useEffect, useRef } from "react";
import { FEST } from "@/lib/data";
import { Reveal } from "./Reveal";

const TEXT =
  "What began in 1973 as a modest sports meet has become South Asia’s largest medical college festival. Four hundred and fifty institutions. Five days. One campus that refuses to sleep — and a wave that carries everyone with it.";

/** Editorial statement whose words light up as it moves through the viewport. */
export default function Manifesto() {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const words = Array.from(el.querySelectorAll<HTMLSpanElement>("[data-w]"));
    let raf = 0;
    let last = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // 0 when the paragraph's top hits 85% of the viewport, 1 when its bottom reaches 45%.
      const p = Math.min(Math.max((vh * 0.85 - r.top) / (r.height + vh * 0.4), 0), 1);
      if (Math.abs(p - last) < 0.001) return;
      last = p;
      const lit = p * words.length;
      words.forEach((w, i) => {
        w.style.opacity = String(0.16 + 0.84 * Math.min(Math.max(lit - i, 0), 1));
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <section className="relative px-6 py-32 md:px-12 md:py-48">
      <div className="mx-auto max-w-[1400px]">
        <div className="grid gap-12 md:grid-cols-12">
          <Reveal className="md:col-span-3">
            <p className="t-label text-bone/50">(04) — Since 1973</p>
          </Reveal>
          <p
            ref={ref}
            className="t-display text-[clamp(2rem,4.2vw,4.25rem)] leading-[1.08] md:col-span-9"
          >
            {TEXT.split(" ").map((w, i) => (
              <span key={i} data-w className="transition-opacity duration-300" style={{ opacity: 0.16 }}>
                {w}{" "}
              </span>
            ))}
          </p>
        </div>

        <dl className="mt-24 grid grid-cols-2 border-t border-bone/12 md:mt-36 md:grid-cols-4">
          {FEST.stats.map((s, i) => (
            <Reveal
              key={s.label}
              delay={i * 90}
              className={`flex flex-col gap-3 border-bone/12 py-10 pr-6 md:py-14 ${i > 0 ? "md:border-l md:pl-8" : ""} ${i % 2 === 1 ? "border-l pl-6" : ""}`}
            >
              <dt className="t-label order-2 text-bone/45">{s.label}</dt>
              <dd className="t-display text-6xl md:text-7xl lg:text-8xl">{s.value}</dd>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}
