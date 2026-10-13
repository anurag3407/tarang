"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, type CSSProperties } from "react";
import { FEST } from "@/lib/data";
import Wordmark from "./Wordmark";
import { easeOutCubic, passProgress, range, useScene } from "./motion";

/**
 * Curtain call. The poster reassembles as you arrive — hands close back in
 * from the edges, the letters fall into place — and leaves you at the door.
 */
export default function Finale() {
  const root = useRef<HTMLElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLDivElement>(null);

  useScene(root, (time, el) => {
    const p = passProgress(el);
    // Fully assembled once the section is centred on screen.
    const k = easeOutCubic(range(p, 0.08, 0.5));
    const t = time / 1000;
    if (top.current) {
      top.current.style.transform = `translate3d(0, calc(${((1 - k) * -100).toFixed(2)}% + ${(Math.sin(t * 0.9) * 6).toFixed(1)}px), 0) rotate(${((1 - k) * -8).toFixed(2)}deg)`;
    }
    if (bottom.current) {
      bottom.current.style.transform = `translate3d(0, calc(${((1 - k) * 100).toFixed(2)}% + ${(Math.sin(t * 0.9 + 1.7) * 6).toFixed(1)}px), 0) rotate(${((1 - k) * 8).toFixed(2)}deg)`;
    }
    mark.current?.querySelectorAll<HTMLElement>("[data-letter]").forEach((node, i) => {
      const li = easeOutCubic(range(p, 0.12 + i * 0.035, 0.38 + i * 0.035));
      const y = (1 - li) * (i % 2 ? 120 : -120) + Math.sin(t * 2.1 - i * 0.8) * 2.4 * li;
      node.style.transform = `translate3d(0, ${y.toFixed(2)}%, 0) rotate(${((1 - li) * (i - 2.5) * 10).toFixed(2)}deg)`;
      node.style.opacity = String(Math.min(1, li * 1.6));
    });
  });

  return (
    <section ref={root} className="t-halftone relative min-h-[110svh] overflow-hidden" aria-labelledby="finale-title">
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 w-[min(132vw,96svh)] -translate-x-1/2 landscape:-translate-y-[14%]">
        <div ref={top} className="origin-top will-change-transform">
          <Image src="/tarang/hands-top.webp" alt="" width={1407} height={833} sizes="(max-width: 768px) 132vw, 96vh" className="h-auto w-full" />
        </div>
      </div>
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/2 w-[min(132vw,96svh)] -translate-x-1/2 landscape:translate-y-[14%]">
        <div ref={bottom} className="origin-bottom will-change-transform">
          <Image src="/tarang/hands-bottom.webp" alt="" width={1402} height={848} sizes="(max-width: 768px) 132vw, 96vh" className="h-auto w-full" />
        </div>
      </div>

      <div className="relative z-10 flex min-h-[110svh] flex-col items-center justify-center px-6 py-24 text-center">
        <p className="t-label text-bone/80">(07) — Curtain call</p>
        <h2 id="finale-title" className="sr-only">
          Mute the mundane. See you at Tarang ’26.
        </h2>
        <div ref={mark} aria-hidden className="mt-8 w-[min(86vw,780px)]">
          <Wordmark />
        </div>
        <p aria-hidden className="t-display mt-6 text-[clamp(1.4rem,3.4vw,2.6rem)] text-bone">
          Unmute <span className="text-ink [-webkit-text-stroke:0.14em_var(--color-bone)] [paint-order:stroke_fill]">November.</span>
        </p>

        <div className="mt-12 flex flex-wrap justify-center gap-4">
          <Link href="/pronite-pass" className="t-btn t-btn-ink">
            Get your Pronite Pass <span className="t-btn-arrow">→</span>
          </Link>
          <Link href="/events" className="t-btn t-btn-solid" style={{ "--t-shadow": "var(--color-ink)" } as CSSProperties}>
            Browse events
          </Link>
        </div>
        <p className="t-label mt-12 max-w-md rounded-[10px] bg-ink/75 px-5 py-3 leading-loose text-bone/80 backdrop-blur-sm">
          {FEST.dates}
          <br />
          <span className="text-bone/55">{FEST.venue}</span>
        </p>
      </div>
    </section>
  );
}
