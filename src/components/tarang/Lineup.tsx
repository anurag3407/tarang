"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";

export type LineupArtist = {
  id: string;
  name: string;
  night: number;
  date: string;
  time: string;
  detail: string;
  image: string | null;
};

/** Muted duotones for generated portraits when no artist photo exists. */
const TONES = [
  ["#c9a46a", "#2a1d0e"],
  ["#e0603f", "#2a110b"],
  ["#8fa3c9", "#111827"],
  ["#a7ad7f", "#1a1c10"],
  ["#c58fa5", "#24121a"],
];

function Name({ text, state }: { text: string; state: "on" | "out" | "idle" }) {
  let n = 0;
  return (
    <span aria-hidden={state !== "on"} className="block">
      {text.split(" ").map((word, wi) => (
        <span key={wi} className="inline-block whitespace-nowrap pr-[0.22em]">
          {Array.from(word).map((ch, ci) => {
            const delay = (n++) * 28;
            return (
              <span
                key={ci}
                className="t-mask"
                data-on={state === "on"}
                data-out={state === "out"}
                style={{ "--t-delay": `${state === "on" ? delay + 120 : delay * 0.4}ms` } as CSSProperties}
              >
                <span>{ch}</span>
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}

function Portrait({ artist, index }: { artist: LineupArtist; index: number }) {
  const [hi, lo] = TONES[index % TONES.length];
  if (artist.image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={artist.image} alt={artist.name} className="h-full w-full object-cover grayscale-[35%]" />
    );
  }
  return (
    <div
      className="relative h-full w-full"
      style={{ background: `radial-gradient(120% 90% at 30% 20%, ${hi}55 0%, ${lo} 55%, #090807 100%)` }}
    >
      <svg viewBox="0 0 300 400" className="absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
        {Array.from({ length: 14 }, (_, i) => {
          const y = 120 + i * 18;
          const amp = 10 + i * 2.2;
          return (
            <path
              key={i}
              d={`M -10 ${y} C 60 ${y - amp}, 110 ${y + amp}, 160 ${y} S 260 ${y - amp}, 320 ${y}`}
              fill="none"
              stroke={hi}
              strokeOpacity={0.08 + i * 0.025}
              strokeWidth={1}
            />
          );
        })}
      </svg>
      <span className="t-display absolute bottom-4 right-5 text-[9rem] leading-none text-bone/90 md:text-[11rem]">
        {String(artist.night).padStart(2, "0")}
      </span>
    </div>
  );
}

export default function Lineup({ artists }: { artists: LineupArtist[] }) {
  const root = useRef<HTMLElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(0);
  const [prev, setPrev] = useState(-1);
  const n = artists.length;

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    let current = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const r = el.getBoundingClientRect();
      const span = r.height - window.innerHeight;
      const p = span > 0 ? Math.min(Math.max(-r.top / span, 0), 0.9999) : 0;
      if (bar.current) bar.current.style.transform = `scaleY(${p})`;
      const idx = Math.floor(p * n);
      if (idx !== current) {
        setPrev(current);
        setActive(idx);
        current = idx;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n]);

  if (n === 0) return null;
  const a = artists[active];

  return (
    <section
      id="lineup"
      ref={root}
      className="relative"
      style={{ height: `${n * 80 + 100}vh` }}
      aria-label="Lineup"
    >
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden px-6 pb-8 pt-24 md:px-12 md:pb-12 md:pt-28">
        <div className="flex items-start justify-between gap-6 border-t border-bone/12 pt-6">
          <p className="t-label text-bone/50">(05) — The Lineup</p>
          <p className="max-w-xs text-right text-sm leading-relaxed text-bone/55">
            After sundown, the Quadrangle becomes a stage. One headline night, every night.
          </p>
        </div>

        <div className="relative grid flex-1 grid-cols-1 items-center gap-8 md:grid-cols-12">
          {/* Index */}
          <ol className="hidden md:col-span-2 md:flex md:flex-col md:gap-3">
            {artists.map((x, i) => (
              <li
                key={x.id}
                className={`t-label flex items-center gap-3 transition-colors duration-500 ${i === active ? "text-bone" : "text-bone/30"}`}
              >
                <span
                  className={`block h-px bg-current transition-all duration-500 ${i === active ? "w-8" : "w-3"}`}
                />
                0{x.night}
              </li>
            ))}
          </ol>

          {/* Name */}
          <div className="relative z-10 order-2 md:order-none md:col-span-6">
            <div className="relative">
              {artists.map((x, i) => (
                <div
                  key={x.id}
                  className={i === active ? "relative" : "absolute inset-x-0 top-0"}
                >
                  <h3 className="t-display text-[clamp(3.2rem,8.4vw,9.5rem)] leading-[0.9]">
                    <Name text={x.name} state={i === active ? "on" : i === prev ? "out" : "idle"} />
                  </h3>
                </div>
              ))}
            </div>
            <div key={a.id} className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-bone/12 pt-5" style={{ animation: "t-fade-in 0.9s ease both" }}>
              <span className="t-label text-brass">Night 0{a.night}</span>
              <span className="t-label text-bone/60">{a.date}</span>
              <span className="t-label text-bone/60">{a.time}</span>
              <span className="t-label text-bone/60">{a.detail}</span>
            </div>
          </div>

          {/* Portrait */}
          <div className="order-1 mx-auto w-[58vw] max-w-[340px] md:order-none md:col-span-4 md:w-full md:max-w-none md:pl-8">
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-[2px] bg-ink-2">
              {artists.map((x, i) => (
                <div
                  key={x.id}
                  className="absolute inset-0 transition-[clip-path] duration-[1100ms] ease-[cubic-bezier(0.7,0,0.2,1)]"
                  style={{
                    clipPath: i <= active ? "inset(0 0 0 0)" : "inset(100% 0 0 0)",
                    zIndex: i,
                  }}
                >
                  <div
                    className="h-full w-full transition-transform duration-[1600ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
                    style={{ transform: i === active ? "scale(1)" : "scale(1.12)" }}
                  >
                    <Portrait artist={x} index={i} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-end justify-between">
          <span className="relative hidden h-16 w-px overflow-hidden bg-bone/15 md:block">
            <span ref={bar} className="absolute inset-0 origin-top bg-bone" style={{ transform: "scaleY(0)" }} />
          </span>
          <Link href="/schedule" className="t-label t-link ml-auto text-bone/70 hover:text-bone">
            Full night schedule →
          </Link>
        </div>
      </div>
    </section>
  );
}
