"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FEST } from "@/lib/data";

const StudioCanvas = dynamic(() => import("./three/StudioCanvas"), { ssr: false });

const CHAPTERS = 3;

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

/**
 * Scroll progress through the pinned stage, eased so each chapter "holds"
 * for a beat before the next transition. Returns e ∈ [0, CHAPTERS - 1].
 */
function chapterProgress(p: number) {
  const segs = CHAPTERS - 1;
  const j = Math.min(Math.floor(p * segs), segs - 1);
  const t = p * segs - j;
  return j + smoothstep(0.18, 0.82, t);
}

export default function HeroStudio() {
  const root = useRef<HTMLElement>(null);
  const progress = useRef(0);
  const wordmark = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const el = root.current;
    if (!el) return;

    const io = new IntersectionObserver(([entry]) => setActive(entry.isIntersecting), {
      rootMargin: "100px",
    });
    io.observe(el);

    const chapters = Array.from(el.querySelectorAll<HTMLElement>("[data-chapter]"));
    let raf = 0;
    let last = -1;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const rect = el.getBoundingClientRect();
      const span = rect.height - window.innerHeight;
      const p = span > 0 ? Math.min(Math.max(-rect.top / span, 0), 1) : 0;
      if (p === last) return;
      last = p;

      const e = chapterProgress(p);
      progress.current = e;

      chapters.forEach((node, i) => {
        const d = e - i;
        const o = Math.max(0, 1 - Math.abs(d) * 2.4);
        node.style.opacity = String(o);
        node.style.transform = `translate3d(0, ${(-d * 48).toFixed(2)}px, 0)`;
        node.style.pointerEvents = o > 0.6 ? "auto" : "none";
        node.style.visibility = o === 0 ? "hidden" : "visible";
      });

      if (wordmark.current) {
        const o = Math.max(0, 1 - e * 1.6);
        wordmark.current.style.opacity = String(o);
        wordmark.current.style.transform = `translate3d(-50%, ${(e * 60).toFixed(1)}px, 0) scale(${1 + e * 0.12})`;
      }
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      // The counter shares the right edge with chapter 03's copy — step aside for it.
      if (hud.current) hud.current.style.opacity = String(1 - smoothstep(1.3, 1.6, e));
      if (counter.current) counter.current.textContent = `0${Math.round(e) + 1}`;
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return (
    <section ref={root} className="relative h-[340vh]" aria-label={`${FEST.short} — introduction`}>
      <div className="sticky top-0 h-[100svh] w-full overflow-hidden">
        {/* Stage lighting */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 55% at 50% 42%, rgba(201,164,106,0.16) 0%, rgba(201,164,106,0.05) 40%, transparent 70%), radial-gradient(120% 80% at 50% 120%, rgba(224,96,63,0.10) 0%, transparent 60%)",
          }}
        />
        {/* Floor line */}
        <div aria-hidden className="absolute inset-x-0 bottom-[22%] h-px bg-gradient-to-r from-transparent via-bone/10 to-transparent" />

        {/* Wordmark sits behind the instrument */}
        <div
          ref={wordmark}
          aria-hidden
          className="t-display pointer-events-none absolute bottom-[17vh] left-1/2 z-0 select-none whitespace-nowrap text-[27vw] text-bone/[0.92] md:bottom-[2vh] md:text-[24vw]"
          style={{ transform: "translate3d(-50%,0,0)" }}
        >
          <span className="block" style={{ animation: "t-fade-in 2s ease both" }}>
            Tarang<span className="align-top text-[0.32em] italic text-brass">’26</span>
          </span>
        </div>

        <div className="absolute inset-0 z-10">
          <StudioCanvas progress={progress} active={active} />
        </div>

        {/* Crop marks */}
        <div aria-hidden className="pointer-events-none absolute inset-x-4 bottom-4 top-20 z-20 md:inset-x-8 md:bottom-8 md:top-24">
          {["left-0 top-0 border-l border-t", "right-0 top-0 border-r border-t", "bottom-0 left-0 border-b border-l", "bottom-0 right-0 border-b border-r"].map(
            (c) => (
              <span key={c} className={`absolute h-4 w-4 border-bone/30 ${c}`} />
            )
          )}
        </div>

        {/* Chapter 01 — the festival */}
        <div data-chapter="0" className="absolute inset-0 z-20">
          <div className="absolute inset-x-6 top-24 flex items-start justify-between md:inset-x-12 md:top-28">
            <p className="t-label text-bone/60">(01) — The Festival</p>
            <p className="t-label text-right text-bone/60">
              <span className="sm:hidden">{FEST.datesShort}</span>
              <span className="hidden sm:inline">
                {FEST.edition}
                <br />
                {FEST.college}
              </span>
            </p>
          </div>
          <div className="absolute inset-x-6 bottom-8 flex items-end justify-between gap-6 md:inset-x-12 md:bottom-12">
            <p className="max-w-[17rem] text-sm leading-relaxed text-bone/70 md:text-[0.95rem]">
              The annual cultural festival of {FEST.college}. Five days, five nights, one frequency.
            </p>
            <div className="hidden flex-col items-center gap-3 md:flex">
              <span className="t-label text-bone/50">Scroll</span>
              <span className="relative block h-10 w-px overflow-hidden bg-bone/15">
                <span className="absolute inset-x-0 top-0 h-1/2 animate-[t-scrollhint_2.2s_cubic-bezier(0.7,0,0.3,1)_infinite] bg-bone" />
              </span>
            </div>
            <p className="t-label hidden text-right text-bone/70 sm:block">
              17 — 21
              <br />
              Sept. 2026
            </p>
          </div>
        </div>

        {/* Chapter 02 — the instrument */}
        <div
          data-chapter="1"
          className="invisible absolute inset-0 z-20 flex items-end px-6 pb-16 opacity-0 md:items-center md:px-12 md:pb-0"
        >
          <div className="max-w-xl">
            <p className="t-label mb-6 text-brass">(02) — Tarang, n. Sanskrit: a wave</p>
            <h2 className="t-display text-[clamp(2.75rem,6.4vw,6.5rem)]">
              Five nights,
              <br />
              <em className="text-brass">one frequency.</em>
            </h2>
            <p className="mt-6 max-w-md text-[0.95rem] leading-relaxed text-bone/65 md:mt-8">
              For five days the campus resonates — 250+ competitions across eight arenas, a headline stage
              every night, and ten thousand voices finding the same note.
            </p>
            <dl className="mt-8 hidden grid-cols-4 gap-6 border-t border-bone/15 pt-6 sm:grid md:mt-12">
              {FEST.stats.map((s) => (
                <div key={s.label}>
                  <dd className="t-display text-3xl md:text-4xl">{s.value}</dd>
                  <dt className="t-label mt-2 text-[0.6rem] text-bone/50">{s.label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Chapter 03 — the invitation */}
        <div
          data-chapter="2"
          className="invisible absolute inset-0 z-20 flex items-end justify-end px-6 pb-16 opacity-0 md:items-center md:px-12 md:pb-0"
        >
          <div className="max-w-lg md:text-right">
            <p className="t-label mb-6 text-brass">(03) — The Invitation</p>
            <h2 className="t-display text-[clamp(2.75rem,6.4vw,6.5rem)]">
              Every string
              <br />
              <em className="text-brass">tells a story.</em>
            </h2>
            <p className="mt-6 max-w-md text-[0.95rem] leading-relaxed text-bone/65 md:ml-auto md:mt-8">
              Passes are live. Pick your access, claim your stage, and meet us at the Quadrangle when the
              lights go down.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 md:mt-10 md:justify-end">
              <Link href="#passes" className="t-btn t-btn-solid">
                Get your pass <span className="t-btn-arrow">→</span>
              </Link>
              <Link href="/events" className="t-btn t-btn-ghost">
                Explore events
              </Link>
            </div>
          </div>
        </div>

        {/* HUD — progress */}
        <div
          ref={hud}
          className="pointer-events-none absolute right-6 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-end gap-3 md:right-12 md:flex"
        >
          <span className="t-label text-bone/80">
            <span ref={counter}>01</span>
            <span className="text-bone/35"> / 0{CHAPTERS}</span>
          </span>
          <span className="relative block h-px w-16 overflow-hidden bg-bone/15">
            <span ref={bar} className="absolute inset-0 origin-left scale-x-0 bg-bone" />
          </span>
        </div>
        <p
          aria-hidden
          className="t-label pointer-events-none absolute left-6 top-1/2 z-20 hidden -translate-y-1/2 rotate-180 text-bone/35 [writing-mode:vertical-rl] md:left-12 md:block"
        >
          Fig. A — Dreadnought, Sunburst
        </p>
      </div>
    </section>
  );
}
