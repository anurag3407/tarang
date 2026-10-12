"use client";

import { useRef } from "react";
import { Speaker } from "./Icons";
import { pinnedProgress, range, useScene } from "./motion";

const MUNDANE = ["Deadlines", "Attendance", "8 AM labs", "Assignments", "Alarms", "Routine"];
const BARS = 28;

/**
 * The tagline as a scroll sequence. Each everyday chore slides into the
 * sentence “Mute the ___”, gets struck through and drops to an outline while
 * the volume meter drains. When the last one is gone, the room floods red and
 * the meter pins to max.
 */
export default function MuteMundane() {
  const root = useRef<HTMLElement>(null);
  const words = useRef<HTMLSpanElement[]>([]);
  const strikes = useRef<HTMLSpanElement[]>([]);
  const rows = useRef<HTMLLIElement[]>([]);
  const bars = useRef<HTMLSpanElement[]>([]);
  const level = useRef<HTMLSpanElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const speaker = useRef<HTMLSpanElement>(null);
  const flood = useRef<HTMLDivElement>(null);
  const loud = useRef<HTMLDivElement>(null);
  const meter = useRef(1);

  const n = MUNDANE.length;

  useScene(root, (time, el) => {
    const p = pinnedProgress(el);
    // n chores, then one beat for the flip.
    const steps = n + 1.4;
    const s = p * steps;
    let muted = 0;

    words.current.forEach((w, i) => {
      const local = s - i; // 0 → 1 is this word’s turn
      const enter = range(local, 0, 0.3);
      const strike = range(local, 0.32, 0.62);
      const leave = range(local, 0.82, 1);
      if (local >= 0.62) muted++;
      w.style.transform = `translate3d(0, ${((1 - enter) * 105 - leave * 105).toFixed(2)}%, 0) rotate(${((1 - enter) * 6 - leave * 4).toFixed(2)}deg)`;
      w.style.visibility = local < -0.05 || local > 1.05 ? "hidden" : "visible";
      w.dataset.muted = String(local >= 0.62);
      const bar = strikes.current[i];
      if (bar) bar.style.transform = `scaleX(${strike.toFixed(4)})`;
    });

    rows.current.forEach((r, i) => {
      r.dataset.on = String(i < muted);
    });

    const flip = range(s, n, n + 0.5);
    const targetLevel = flip > 0 ? 1 : 1 - muted / n;
    meter.current += (targetLevel - meter.current) * 0.12;

    const t = time / 1000;
    bars.current.forEach((b, i) => {
      const noise =
        0.55 +
        0.25 * Math.sin(t * (flip > 0 ? 9 : 4.2) + i * 1.3) +
        0.2 * Math.sin(t * (flip > 0 ? 13 : 6.7) + i * 0.47);
      const h = Math.max(0.04, noise * meter.current);
      b.style.transform = `scaleY(${h.toFixed(3)})`;
    });

    if (level.current) level.current.textContent = String(Math.round(meter.current * 100)).padStart(2, "0");
    if (count.current) count.current.textContent = `0${Math.min(muted, n)}`;
    if (speaker.current) speaker.current.dataset.muted = String(muted === n && flip === 0);
    if (flood.current) flood.current.style.clipPath = `inset(${((1 - flip) * 100).toFixed(2)}% 0 0 0)`;
    if (loud.current) {
      const c = range(s, n + 0.2, n + 0.7);
      loud.current.style.opacity = String(c);
      loud.current.style.transform = `scale(${(1.25 - c * 0.25).toFixed(4)})`;
    }
  });

  return (
    <section ref={root} className="relative bg-ink" style={{ height: `${(n + 1.4) * 55 + 100}vh` }} aria-label="Mute the mundane">
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden px-6 pb-8 pt-24 md:px-12 md:pb-12 md:pt-28">
        <div className="flex items-start justify-between gap-6 border-t border-bone/15 pt-5">
          <p className="t-label text-bone/50">(01) — The Manifesto</p>
          <p className="t-label text-right text-bone/50">
            Muted <span ref={count} className="text-bone">00</span> / 0{n}
          </p>
        </div>

        <div className="grid flex-1 items-center gap-10 md:grid-cols-12">
          {/* The sentence */}
          <div className="md:col-span-9">
            <p className="t-display text-[clamp(2.6rem,8.4vw,9.5rem)] leading-[0.86] text-bone">Mute</p>
            <p className="t-display text-[clamp(2.6rem,8.4vw,9.5rem)] leading-[0.86] text-bone/35">the</p>
            <div className="relative h-[1.02em] overflow-hidden text-[clamp(2.6rem,8.4vw,9.5rem)]" aria-live="off">
              {MUNDANE.map((w, i) => (
                <span
                  key={w}
                  ref={(el) => {
                    if (el) words.current[i] = el;
                  }}
                  className="group/w invisible absolute left-0 top-0 whitespace-nowrap will-change-transform"
                  style={{ transform: "translate3d(0,105%,0)" }}
                >
                  <span className="t-display relative inline-block leading-[0.95] text-signal transition-[color] duration-500 group-data-[muted=true]/w:text-transparent group-data-[muted=true]/w:[-webkit-text-stroke:2px_rgba(244,234,200,0.5)]">
                    {w}.
                    <span
                      ref={(el) => {
                        if (el) strikes.current[i] = el;
                      }}
                      className="absolute left-[-3%] top-[46%] h-[0.09em] w-[106%] origin-left -rotate-2 scale-x-0 bg-signal"
                    />
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Mixing desk */}
          <div className="md:col-span-3">
            <div className="flex items-end justify-between border-b border-bone/15 pb-3">
              <span
                ref={speaker}
                className="group/s flex items-center gap-2 text-bone data-[muted=true]:text-signal"
                data-muted="false"
              >
                <Speaker className="h-5 w-5 group-data-[muted=true]/s:hidden" />
                <Speaker muted className="hidden h-5 w-5 group-data-[muted=true]/s:block" />
                <span className="t-label">Master</span>
              </span>
              <span className="t-display text-4xl tabular-nums md:text-5xl">
                <span ref={level}>100</span>
              </span>
            </div>
            <div className="mt-4 flex h-28 items-end gap-[3px] md:h-36" aria-hidden>
              {Array.from({ length: BARS }, (_, i) => (
                <span
                  key={i}
                  ref={(el) => {
                    if (el) bars.current[i] = el;
                  }}
                  className="block h-full flex-1 origin-bottom bg-bone"
                  style={{ opacity: 0.35 + (i / BARS) * 0.65, transform: "scaleY(0.6)" }}
                />
              ))}
            </div>
            <ul className="mt-6 hidden md:block">
              {MUNDANE.map((w, i) => (
                <li
                  key={w}
                  ref={(el) => {
                    if (el) rows.current[i] = el;
                  }}
                  data-on="false"
                  className="group/r t-label flex items-center justify-between border-t border-bone/10 py-2.5 text-bone/25 transition-colors duration-500 data-[on=true]:text-bone/80"
                >
                  <span>{w}</span>
                  <span className="text-signal opacity-0 transition-opacity duration-500 group-data-[on=true]/r:opacity-100">
                    Muted
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="t-label text-bone/40">Keep scrolling — it gets louder.</p>

        {/* The flip — the room floods red */}
        <div
          ref={flood}
          className="t-halftone absolute inset-0 z-10 flex items-center justify-center"
          style={{ clipPath: "inset(100% 0 0 0)" }}
        >
          <div ref={loud} className="px-6 text-center opacity-0">
            <p className="t-label flex items-center justify-center gap-2 text-bone">
              <Speaker className="h-4 w-4" /> Master 100
            </p>
            <p className="t-display t-cut mt-6 text-[clamp(3.2rem,10.5vw,10.5rem)] leading-[0.86]">
              Now,
              <br />
              turn it up.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
