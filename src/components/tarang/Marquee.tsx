"use client";

import { useRef } from "react";
import { Ring } from "./Icons";
import { scrollVelocity, useScene } from "./motion";

const ARTS = ["Music", "Dance", "Theatre", "Literary", "Fine Arts", "Quizzing", "Fashion", "Pro Nights", "Informals"];
const CHANT = ["Mute the mundane", "Sept 2026", "Five nights", "Turn it up"];

function Row({ words, tone }: { words: string[]; tone: "red" | "cream" }) {
  return (
    <div className="flex shrink-0 items-center">
      {words.map((w) => (
        <span key={w} className="flex items-center">
          <span
            className={`t-display whitespace-nowrap px-6 text-[clamp(2.4rem,6vw,5.5rem)] md:px-10 ${
              tone === "red" ? "t-cut" : "text-ink"
            }`}
          >
            {w}
          </span>
          <Ring className={`h-7 w-7 shrink-0 md:h-10 md:w-10 ${tone === "red" ? "text-bone" : "text-blood"}`} />
        </span>
      ))}
    </div>
  );
}

/**
 * Two strips of gaffer tape crossing the page. They idle slowly and surge
 * with scroll speed, leaning into the direction of travel.
 */
export default function Marquee() {
  const root = useRef<HTMLElement>(null);
  const a = useRef<HTMLDivElement>(null);
  const b = useRef<HTMLDivElement>(null);
  const pos = useRef({ a: 0, b: 0, skew: 0 });

  useScene(root, () => {
    const v = scrollVelocity();
    const s = pos.current;
    const boost = Math.min(Math.abs(v) * 0.09, 6);
    const dir = v < -0.5 ? -1 : 1;
    s.skew += (Math.max(-8, Math.min(8, v * 0.35)) - s.skew) * 0.1;
    for (const [key, el, sign] of [
      ["a", a.current, -1],
      ["b", b.current, 1],
    ] as const) {
      if (!el) continue;
      const half = el.scrollWidth / 2;
      s[key] += (0.6 + boost) * sign * dir;
      if (s[key] <= -half) s[key] += half;
      if (s[key] > 0) s[key] -= half;
      el.style.transform = `translate3d(${s[key].toFixed(1)}px,0,0) skewX(${(-s.skew * sign).toFixed(2)}deg)`;
    }
  });

  return (
    <section ref={root} aria-label="Disciplines" className="relative flex h-[46vh] items-center overflow-hidden bg-ink md:h-[64vh]">
      <div className="absolute inset-x-[-10%] top-1/2 -translate-y-[85%] rotate-[-5deg] border-y-[3px] border-ink bg-crimson py-3 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.8)] md:py-5">
        <div ref={a} className="flex w-max will-change-transform">
          <Row words={ARTS} tone="red" />
          <Row words={ARTS} tone="red" />
        </div>
      </div>
      <div className="absolute inset-x-[-10%] top-1/2 -translate-y-[5%] rotate-[3.5deg] border-y-[3px] border-ink bg-bone py-3 md:py-5" aria-hidden>
        <div ref={b} className="flex w-max will-change-transform">
          <Row words={CHANT} tone="cream" />
          <Row words={CHANT} tone="cream" />
          <Row words={CHANT} tone="cream" />
        </div>
      </div>
    </section>
  );
}
