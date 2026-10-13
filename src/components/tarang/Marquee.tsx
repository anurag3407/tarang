"use client";

import { useEffect, useRef } from "react";
import { Ring } from "./Icons";
import { scrollVelocity, useScene } from "./motion";

const ARTS = ["Music", "Dance", "Theatre", "Literary", "Fine Arts", "Quizzing", "Fashion", "Pro Nights", "Informals"];
const CHANT = ["Mute the mundane", "Nov 2026", "Two nights", "Turn it up"];

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

  // Lay the tapes corner to corner: each runs along a diagonal of the section,
  // so its angle and length follow the section's own proportions.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const fit = () => {
      const { width, height } = el.getBoundingClientRect();
      el.style.setProperty("--tape-len", `${Math.hypot(width, height) * 1.12}px`);
      el.style.setProperty("--tape-ang", `${Math.atan2(height, width)}rad`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const tape =
    "absolute left-1/2 top-1/2 w-[var(--tape-len,140vw)] border-y-[3px] border-ink py-3 shadow-[0_24px_50px_-18px_rgba(0,0,0,0.85)] md:py-5";

  return (
    <section
      ref={root}
      aria-label="Disciplines"
      className="relative h-[72vh] overflow-hidden bg-ink md:h-[92vh]"
      style={{
        background:
          "radial-gradient(55% 60% at 0% 0%, rgba(163,16,13,0.55), transparent 70%), radial-gradient(55% 60% at 100% 100%, rgba(163,16,13,0.5), transparent 70%), radial-gradient(40% 45% at 100% 0%, rgba(110,0,1,0.45), transparent 70%), radial-gradient(40% 45% at 0% 100%, rgba(110,0,1,0.45), transparent 70%), var(--color-ink)",
      }}
    >
      {/* Halftone dots, densest where the tapes cross */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(circle, rgba(196,24,18,0.5) 0 30%, transparent 33%)",
          backgroundSize: "22px 22px",
          WebkitMaskImage: "radial-gradient(70% 70% at 50% 50%, #000 0%, transparent 75%)",
          maskImage: "radial-gradient(70% 70% at 50% 50%, #000 0%, transparent 75%)",
        }}
      />

      {/* Ghost lettering behind the tapes */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center select-none">
        <p className="t-display whitespace-nowrap text-[18vw] leading-[0.85] text-transparent [-webkit-text-stroke:1.5px_rgba(244,234,200,0.14)]">
          Mute the
        </p>
        <p className="t-display whitespace-nowrap text-[18vw] leading-[0.85] text-transparent [-webkit-text-stroke:1.5px_rgba(255,59,31,0.22)]">
          Mundane
        </p>
      </div>

      {/* Studio slug lines in the free corners */}
      <p className="t-label absolute left-1/2 top-6 -translate-x-1/2 text-bone/55 md:top-10">(—) Eight arenas</p>
      <p className="t-label absolute bottom-6 left-1/2 -translate-x-1/2 text-bone/55 md:bottom-10">Two nights · one wave</p>

      {/* Tape A: top-left corner to bottom-right */}
      <div className={`${tape} bg-crimson`} style={{ transform: "translate(-50%, -50%) rotate(var(--tape-ang, 0.5rad))" }}>
        <div ref={a} className="flex w-max will-change-transform">
          <Row words={ARTS} tone="red" />
          <Row words={ARTS} tone="red" />
        </div>
      </div>
      {/* Tape B: bottom-left corner to top-right */}
      <div
        className={`${tape} bg-bone`}
        style={{ transform: "translate(-50%, -50%) rotate(calc(var(--tape-ang, 0.5rad) * -1))" }}
        aria-hidden
      >
        <div ref={b} className="flex w-max will-change-transform">
          <Row words={CHANT} tone="cream" />
          <Row words={CHANT} tone="cream" />
          <Row words={CHANT} tone="cream" />
        </div>
      </div>
    </section>
  );
}
