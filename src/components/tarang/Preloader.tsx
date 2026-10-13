"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Wordmark from "./Wordmark";
import { clamp, easeInOutCubic, finishIntro, getLenis, prefersReducedMotion } from "./motion";

const SEEN_KEY = "tarang:intro";
const TICKS = 61;

/**
 * Opening card. A radio dial tunes in while the letters arrive one by one,
 * then the screen tears along its middle — top half up, bottom half down —
 * the way the poster’s hands pull apart.
 *
 * Plays in full once per browser session; afterwards it is a quick blink.
 */
export default function Preloader() {
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      // storage blocked — play the full intro
    }
    const quick = seen || prefersReducedMotion();
    const duration = quick ? 320 : 2300;

    const root = document.documentElement;
    const lenis = getLenis();
    lenis?.stop();
    root.style.overflow = "hidden";
    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      root.style.overflow = "";
      getLenis()?.start();
    };

    const timers: ReturnType<typeof setTimeout>[] = [];
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = clamp((now - start) / duration);
      setCount(Math.round(easeInOutCubic(t) * 100));
      if (t < 1) {
        raf = requestAnimationFrame(tick);
        return;
      }
      timers.push(
        setTimeout(() => {
          try {
            sessionStorage.setItem(SEEN_KEY, "1");
          } catch {
            // storage blocked — it simply plays again next time
          }
          setDone(true);
          finishIntro();
          release();
        }, quick ? 0 : 280),
        setTimeout(() => setGone(true), quick ? 1300 : 1700)
      );
    });

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      release();
      finishIntro();
    };
  }, []);

  if (gone) return null;

  return (
    <div className="t-preloader" data-done={done} aria-hidden>
      <div className="t-preloader-half" data-half="top">
        <Face count={count} edge="top" />
      </div>
      <div className="t-preloader-half" data-half="bottom">
        <Face count={count} edge="bottom" />
      </div>
    </div>
  );
}

/** Rendered once per half; each half shows its own slice of the same card. */
function Face({ count, edge }: { count: number; edge: "top" | "bottom" }) {
  const needle = count / 100;
  return (
    <div
      className={`t-halftone absolute inset-x-0 h-[100svh] overflow-hidden ${edge === "top" ? "top-0" : "bottom-0"}`}
    >
      <div className="absolute inset-x-6 top-6 flex items-start justify-between md:inset-x-12 md:top-10">
        <p className="t-label text-bone/80">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-signal align-middle [animation:t-blink_1s_steps(1)_infinite]" />
          Tuning in
        </p>
        <p className="t-label text-right text-bone/80">Mute the mundane</p>
      </div>

      <div className="absolute left-1/2 top-1/2 w-[min(84vw,860px)] -translate-x-1/2 -translate-y-1/2">
        <Wordmark
          letterStyle={(i) => {
            const on = count > 10 + i * 13;
            return {
              opacity: on ? 1 : 0,
              transform: on ? "none" : `translate3d(0, ${i % 2 ? 30 : -30}%, 0) scale(0.85)`,
              transition: "transform 0.7s cubic-bezier(0.34,1.56,0.64,1), opacity 0.25s ease",
            } as CSSProperties;
          }}
        />

        {/* Frequency dial */}
        <div className="relative mt-10 md:mt-14" aria-hidden>
          <div className="flex h-6 items-end justify-between">
            {Array.from({ length: TICKS }, (_, i) => (
              <span
                key={i}
                className="block w-px bg-bone/50"
                style={{ height: i % 10 === 0 ? "100%" : i % 5 === 0 ? "60%" : "35%" }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between">
            {["21", "22", "NOV"].map((d) => (
              <span key={d} className="t-label text-[0.6rem] text-bone/60">
                {d}
              </span>
            ))}
          </div>
          <span
            className="absolute -top-2 bottom-5 w-[2px] bg-signal"
            style={{ left: `${needle * 100}%`, boxShadow: "0 0 12px rgba(255,59,31,0.8)" }}
          />
        </div>
      </div>

      <div className="absolute inset-x-6 bottom-5 flex items-end justify-between md:inset-x-12 md:bottom-8">
        <p className="t-label max-w-[12rem] leading-relaxed text-bone/70">
          Loading the loud
          <br />
          Nov 2026
        </p>
        <p className="t-display t-cut text-[clamp(4.5rem,13vw,11rem)] leading-[0.8] tabular-nums">
          {String(count).padStart(3, "0")}
        </p>
      </div>
    </div>
  );
}
