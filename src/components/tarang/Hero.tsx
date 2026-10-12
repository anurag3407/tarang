"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { FEST } from "@/lib/data";
import Wordmark from "./Wordmark";
import { Speaker } from "./Icons";
import { easeInOutCubic, pinnedProgress, range, useScene, whenIntroDone } from "./motion";

function timecode(ms: number) {
  const f = Math.floor((ms / 1000) * 24);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(f / 86400))}:${pad(Math.floor(f / 1440) % 60)}:${pad(Math.floor(f / 24) % 60)}:${pad(f % 24)}`;
}

/**
 * The poster, alive. Hands hang from the top and rise from the bottom, the
 * lettering ripples like a wave (tarang), and as you scroll the hands pull
 * apart while their mudra ring closes over the screen and mutes everything.
 */
export default function Hero() {
  const root = useRef<HTMLElement>(null);
  const handsTop = useRef<HTMLDivElement>(null);
  const handsBottom = useRef<HTMLDivElement>(null);
  const lockup = useRef<HTMLDivElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const iris = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const irisCopy = useRef<HTMLDivElement>(null);
  const tc = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);

  const pointer = useRef({ x: 0, y: 0, sx: 0, sy: 0, energy: 0 });
  const born = useRef(0);

  useEffect(() => {
    born.current = performance.now();
    const off = whenIntroDone(() => {
      if (root.current) root.current.dataset.in = "true";
    });
    const move = (e: PointerEvent) => {
      const p = pointer.current;
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      p.energy = Math.min(p.energy + Math.hypot(nx - p.x, ny - p.y) * 3, 1.6);
      p.x = nx;
      p.y = ny;
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      off();
      window.removeEventListener("pointermove", move);
    };
  }, []);

  useScene(root, (time, el) => {
    const p = pinnedProgress(el);
    const ptr = pointer.current;
    ptr.sx += (ptr.x - ptr.sx) * 0.06;
    ptr.sy += (ptr.y - ptr.sy) * 0.06;
    ptr.energy *= 0.96;
    const t = time / 1000;

    const open = easeInOutCubic(range(p, 0, 0.5));
    const close = easeInOutCubic(range(p, 0.38, 0.9));

    if (handsTop.current) {
      handsTop.current.style.transform = `translate3d(${(-ptr.sx * 16).toFixed(1)}px, calc(${(-open * 80).toFixed(2)}% + ${(Math.sin(t * 0.9) * 7 - ptr.sy * 10).toFixed(1)}px), 0) rotate(${(-open * 7 + Math.sin(t * 0.6) * 0.6).toFixed(2)}deg)`;
    }
    if (handsBottom.current) {
      handsBottom.current.style.transform = `translate3d(${(ptr.sx * 16).toFixed(1)}px, calc(${(open * 80).toFixed(2)}% + ${(Math.sin(t * 0.9 + 1.7) * 7 - ptr.sy * 10).toFixed(1)}px), 0) rotate(${(open * 7 + Math.sin(t * 0.6 + 1) * 0.6).toFixed(2)}deg)`;
    }

    if (lockup.current) {
      lockup.current.style.transform = `translate3d(${(ptr.sx * 8).toFixed(1)}px, ${(ptr.sy * 6).toFixed(1)}px, 0) scale(${(1 + open * 0.28).toFixed(4)})`;
      // The wave: each letter bobs a beat behind the one before it.
      const amp = 3.2 * (1 - open * 0.6) + ptr.energy * 6;
      lockup.current.querySelectorAll<HTMLElement>("[data-letter]").forEach((node, i) => {
        const y = Math.sin(t * 2.1 - i * 0.8) * amp;
        const x = (i - 2.5) * open * 5;
        const r = Math.cos(t * 2.1 - i * 0.8) * amp * 0.35;
        node.style.transform = `translate3d(${x.toFixed(2)}%, ${y.toFixed(2)}%, 0) rotate(${r.toFixed(2)}deg)`;
      });
      const fade = String(1 - range(p, 0.04, 0.24));
      lockup.current.querySelectorAll<HTMLElement>("[data-meta]").forEach((node) => (node.style.opacity = fade));
    }
    if (hud.current) hud.current.style.opacity = String(1 - range(p, 0, 0.18));
    if (shade.current) shade.current.style.opacity = String(open * 0.55);

    if (iris.current && ring.current && irisCopy.current) {
      const r = (close * Math.hypot(window.innerWidth, window.innerHeight)) / 2 + 1;
      const clip = close > 0 ? `circle(${r.toFixed(1)}px at 50% 50%)` : "circle(0px at 50% 50%)";
      iris.current.style.clipPath = clip;
      iris.current.style.visibility = close > 0 ? "visible" : "hidden";
      ring.current.style.width = ring.current.style.height = `${(r * 2 + 10).toFixed(1)}px`;
      ring.current.style.opacity = close > 0 && close < 0.98 ? "1" : "0";
      const c = range(p, 0.62, 0.92);
      irisCopy.current.style.opacity = String(c);
      irisCopy.current.style.transform = `scale(${(0.86 + c * 0.14).toFixed(4)})`;
    }

    if (tc.current) tc.current.textContent = timecode(time - born.current);
    if (bar.current) bar.current.style.transform = `scaleY(${p.toFixed(4)})`;
  });

  return (
    <section ref={root} data-in="false" className="relative h-[290vh] bg-ink" aria-labelledby="hero-title">
      <h1 id="hero-title" className="sr-only">
        {FEST.short} — Mute the Mundane. {FEST.dates}.
      </h1>

      <div className="t-halftone sticky top-0 h-[100svh] w-full overflow-hidden">
        <div ref={shade} aria-hidden className="absolute inset-0 bg-ink opacity-0" />

        {/* Hands — top pair hangs in, bottom pair rises up */}
        <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 z-10 w-[min(132vw,96svh)] -translate-x-1/2 landscape:-translate-y-[9%]">
          <div ref={handsTop} className="origin-top will-change-transform">
            <div className="t-enter-down">
              <Image src="/tarang/hands-top.webp" alt="" width={1407} height={833} loading="eager" fetchPriority="high" sizes="(max-width: 768px) 132vw, 96vh" className="h-auto w-full select-none" draggable={false} />
            </div>
          </div>
        </div>
        <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/2 z-10 w-[min(132vw,96svh)] -translate-x-1/2 landscape:translate-y-[9%]">
          <div ref={handsBottom} className="origin-bottom will-change-transform">
            <div className="t-enter-up">
              <Image src="/tarang/hands-bottom.webp" alt="" width={1402} height={848} loading="eager" sizes="(max-width: 768px) 132vw, 96vh" className="h-auto w-full select-none" draggable={false} />
            </div>
          </div>
        </div>

        {/* Lockup */}
        <div aria-hidden className="absolute left-1/2 top-1/2 z-20 w-[min(88vw,84svh)] -translate-x-1/2 -translate-y-1/2">
          <div ref={lockup} className="will-change-transform">
            <div data-meta>
              <div className="t-enter-wipe mb-[1.2%] ml-auto w-[49.2%]" style={{ transitionDelay: "1000ms" }}>
                <Image src="/tarang/tagline.webp" alt="" width={581} height={57} loading="eager" className="h-auto w-full" />
              </div>
            </div>
            <Wordmark eager letterClassName="will-change-transform" innerClassName="t-enter-letter" sizes="(max-width: 768px) 16vw, 150px" />
            <div data-meta>
              <div className="t-enter-wipe mt-[2.2%] w-[34.6%]" style={{ transitionDelay: "1120ms" }}>
                <Image src="/tarang/date.webp" alt="" width={409} height={69} loading="eager" className="h-auto w-full" />
              </div>
            </div>
          </div>
        </div>

        {/* HUD */}
        <div ref={hud} className="pointer-events-none absolute inset-0 z-30">
          <div className="t-enter-fade absolute inset-0" style={{ transitionDelay: "1300ms" }}>
            <div className="absolute inset-x-6 top-20 flex items-start justify-between md:inset-x-12 md:top-24">
              <p className="t-label flex items-center gap-3 text-bone/85">
                <span className="inline-block h-2 w-2 rounded-full bg-signal [animation:t-blink_1.2s_steps(1)_infinite]" />
                Rec
                <span ref={tc} className="tabular-nums text-bone/55">
                  00:00:00:00
                </span>
              </p>
              <p className="t-label text-right text-bone/70">
                Ch. ’26
                <br />
                <span className="text-bone/45">17—21 · 09</span>
              </p>
            </div>

            <p className="t-label absolute left-6 top-1/2 hidden -translate-y-1/2 rotate-180 text-bone/50 [writing-mode:vertical-rl] md:left-12 md:block">
              <span className="t-deva mr-3 inline-block rotate-90 text-base normal-case tracking-normal text-bone/80">तरंग</span>
              n. — a wave
            </p>
            <span className="absolute right-6 top-1/2 hidden h-24 w-px -translate-y-1/2 overflow-hidden bg-bone/20 md:right-12 md:block">
              <span ref={bar} className="absolute inset-0 origin-top scale-y-0 bg-bone" />
            </span>

            <div className="absolute inset-x-6 bottom-6 flex items-end justify-between gap-6 md:inset-x-12 md:bottom-10">
              <p className="hidden max-w-[16rem] text-sm leading-relaxed text-bone/75 md:block">
                The cultural festival of {FEST.college}. Five days to drown out the dull.
              </p>
              <div className="mx-auto flex flex-col items-center gap-3 md:mx-0">
                <span className="t-label flex items-center gap-2 text-bone/80">
                  <Speaker className="h-4 w-4" /> Scroll to mute
                </span>
                <span className="relative block h-10 w-px overflow-hidden bg-bone/20">
                  <span className="absolute inset-x-0 top-0 h-1/2 animate-[t-scrollhint_2.2s_cubic-bezier(0.7,0,0.3,1)_infinite] bg-bone" />
                </span>
              </div>
              <p className="t-label hidden text-right text-bone/75 md:block">
                Sept 2026
                <br />
                <span className="text-bone/45">Five nights</span>
              </p>
            </div>
          </div>
        </div>

        {/* The mudra ring closes — everything goes quiet */}
        <div
          ref={iris}
          className="invisible absolute inset-0 z-40 flex items-center justify-center bg-ink"
          style={{ clipPath: "circle(0px at 50% 50%)" }}
        >
          <div ref={irisCopy} className="px-6 text-center opacity-0">
            <p className="t-label flex items-center justify-center gap-2 text-signal">
              <Speaker muted className="h-4 w-4" /> Volume 00
            </p>
            <p className="t-display t-cut mt-6 text-[clamp(5rem,19vw,17rem)] leading-[0.85]">Shhh.</p>
            <p className="mx-auto mt-8 max-w-sm text-base leading-relaxed text-bone/65 md:text-lg">
              Everything ordinary is about to go on mute.
            </p>
          </div>
        </div>
        <div
          ref={ring}
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2 rounded-full border-[6px] border-bone opacity-0"
          style={{ width: 0, height: 0 }}
        />
      </div>
    </section>
  );
}
