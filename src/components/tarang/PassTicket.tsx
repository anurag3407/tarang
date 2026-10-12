"use client";

import Image from "next/image";
import { useRef, type CSSProperties, type PointerEvent } from "react";
import { FEST } from "@/lib/data";
import { CircleText, Ring } from "./Icons";
import Wordmark from "./Wordmark";

/** Deterministic barcode widths from the serial so SSR and client agree. */
function bars(seed: string, n = 42) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return 1 + (h % 3);
  });
}

/** The wavy seam between paper and print — tarang, literally. Drawn for a 100×100 box. */
const SEAM =
  "M38 0 C 18 10, 52 22, 30 34 S 8 52, 34 62 S 58 80, 26 90 S 30 98, 36 100 L 100 100 L 100 0 Z";

/**
 * The Pronite Pass, printed as a gig ticket: cream stock, a red halftone
 * panel behind a wave-cut seam with the poster’s hands reaching through, and a
 * perforated stub carrying date, time and barcode. Horizontal on wide
 * containers; on narrow ones it stands upright with the stub at the foot.
 */
export default function PassTicket({
  price,
  serial = "No. 0026 — PRN",
  className = "",
}: {
  price: string;
  serial?: string;
  className?: string;
}) {
  const card = useRef<HTMLDivElement>(null);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = card.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    el.style.transform = `perspective(1600px) rotateX(${((0.5 - y) * 6).toFixed(2)}deg) rotateY(${((x - 0.5) * 8).toFixed(2)}deg)`;
  };
  const onLeave = () => {
    if (card.current) card.current.style.transform = "perspective(1600px)";
  };

  return (
    <div className={`@container ${className}`}>
      <div
        ref={card}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className="kit-ticket group/t relative flex flex-col drop-shadow-[0_40px_60px_rgba(0,0,0,0.55)] transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform @2xl:flex-row"
      >
        {/* ---------------- Main stock ---------------- */}
        <div className="kit-ticket-main relative flex aspect-[4/5] flex-col overflow-hidden rounded-t-[16px] bg-bone text-ink @2xl:aspect-auto @2xl:h-[35cqw] @2xl:flex-1 @2xl:rounded-l-[16px] @2xl:rounded-tr-none">
          {/* Print panel */}
          <div className="absolute inset-x-0 top-0 h-[44%] @2xl:inset-y-0 @2xl:left-auto @2xl:right-0 @2xl:h-full @2xl:w-[46%]">
            <div className="t-halftone absolute inset-0" />
            <div aria-hidden className="absolute -bottom-[38%] left-1/2 w-[120%] -translate-x-1/2 @2xl:-bottom-[18%] @2xl:left-[58%] @2xl:w-[130%]">
              <Image
                src="/tarang/hands-bottom.webp"
                alt=""
                width={1402}
                height={848}
                sizes="(max-width: 768px) 100vw, 640px"
                className="h-auto w-full transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/t:-translate-y-[4%]"
              />
            </div>
            {/* Wave-cut seam: paper laps over the print */}
            <svg
              aria-hidden
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute bottom-[-1px] left-0 h-[34%] w-full rotate-180 @2xl:bottom-auto @2xl:left-[-1px] @2xl:top-0 @2xl:h-full @2xl:w-[34%] @2xl:rotate-0"
            >
              <g className="@2xl:hidden" transform="rotate(90 50 50)">
                <path d={SEAM} fill="var(--color-bone)" transform="scale(-1,1) translate(-100,0)" />
              </g>
              <path className="hidden @2xl:block" d={SEAM} fill="var(--color-bone)" transform="scale(-1,1) translate(-100,0)" />
              <path
                className="hidden @2xl:block"
                d="M38 0 C 18 10, 52 22, 30 34 S 8 52, 34 62 S 58 80, 26 90 S 30 98, 36 100"
                fill="none"
                stroke="var(--color-ink)"
                strokeWidth="1.2"
                vectorEffect="non-scaling-stroke"
                transform="scale(-1,1) translate(-100,0)"
              />
            </svg>
          </div>

          {/* Venue stamp, riding the seam */}
          <div
            aria-hidden
            className="absolute right-[5%] top-[4%] z-10 h-[24cqw] w-[24cqw] @2xl:right-auto @2xl:left-[49%] @2xl:top-[5%] @2xl:h-[8.5cqw] @2xl:w-[8.5cqw]"
          >
            <div className="absolute inset-0 rounded-full border-[0.4cqw] border-ink bg-bone @2xl:border-[0.18cqw]" />
            <CircleText
              id="ticket-stamp"
              text={`${FEST.collegeShort} · Pronite · Tarang ’26 · `}
              className="absolute inset-[4%] animate-[t-spin_22s_linear_infinite] text-ink"
            />
            <Ring className="absolute inset-[33%] text-blood" />
          </div>

          {/* Paper content */}
          <div className="relative mt-auto flex h-[56%] flex-col px-[7cqw] pb-[6cqw] pt-[3cqw] @2xl:mt-0 @2xl:h-full @2xl:w-[58%] @2xl:px-[3.2cqw] @2xl:pb-[2.6cqw] @2xl:pt-[2.8cqw]">
            <p className="t-display absolute left-[2.2cqw] top-1/2 hidden -translate-y-1/2 rotate-180 text-[1.15cqw] tracking-[0.12em] [writing-mode:vertical-rl] @2xl:block">
              #MuteTheMundane
            </p>

            <div className="@2xl:pl-[2cqw]">
              <Wordmark tone="cut" className="kit-ticket-mark w-[72%] @2xl:w-[74%]" />
              <span className="mt-[2.5cqw] inline-block rounded-full bg-blood px-[3.4cqw] py-[1cqw] font-[family-name:var(--font-mono)] text-[2.9cqw] uppercase tracking-[0.18em] text-bone @2xl:mt-[1.2cqw] @2xl:px-[1.4cqw] @2xl:py-[0.45cqw] @2xl:text-[0.95cqw]">
                Pronite pass · all nights
              </span>
            </div>

            <div className="mt-auto flex items-end justify-between gap-[3cqw] @2xl:pl-[2cqw]">
              <p className="t-display text-[5.4cqw] leading-[0.95] @2xl:text-[2cqw]">
                You’re
                <br />
                <span className="text-blood">not</span>
                <br />
                mundane
              </p>
              <div className="text-right @2xl:text-center">
                <p className="t-display text-[10cqw] leading-[0.9] @2xl:text-[4.2cqw]">
                  {FEST.ticketDate}
                  <br />
                  {FEST.proniteTime}
                </p>
              </div>
            </div>
            <p className="t-display mt-[3cqw] text-[3.4cqw] leading-tight @2xl:mt-[1.2cqw] @2xl:pl-[2cqw] @2xl:text-[1.25cqw]">
              {FEST.venueShort}
            </p>
          </div>

          {/* Foil sheen follows the cursor */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 mix-blend-soft-light transition-opacity duration-700 group-hover/t:opacity-100"
            style={{ background: "radial-gradient(35% 45% at var(--mx,50%) var(--my,50%), rgba(255,255,255,0.7), transparent 70%)" }}
          />
        </div>

        {/* ---------------- Stub ---------------- */}
        <div
          className="kit-ticket-stub relative flex items-stretch rounded-b-[16px] border-t-[3px] border-dashed border-ink/50 bg-bone text-ink transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] @2xl:h-[35cqw] @2xl:w-[22%] @2xl:flex-col @2xl:rounded-r-[16px] @2xl:rounded-bl-none @2xl:border-l-[3px] @2xl:border-t-0 @2xl:group-hover/t:translate-x-[0.8cqw] @2xl:group-hover/t:rotate-[1.5deg]"
          style={{ "--notch": "14px" } as CSSProperties}
        >
          <div className="flex min-h-0 flex-1 flex-col justify-between gap-[3cqw] p-[6cqw] @2xl:gap-[0.8cqw] @2xl:p-[1.8cqw]">
            <p className="t-display text-[3.4cqw] @2xl:text-[1.1cqw]">#Tarang26</p>

            <div className="flex items-center justify-between gap-[4cqw] @2xl:flex-1 @2xl:justify-center @2xl:gap-[1.6cqw]">
              <div className="flex gap-[4cqw] @2xl:rotate-180 @2xl:gap-[1.2cqw] @2xl:[writing-mode:vertical-rl]">
                <p className="t-display text-[4.6cqw] leading-none @2xl:text-[1.75cqw]">
                  <span className="text-blood">Date</span> {FEST.ticketDateShort}
                </p>
                <p className="t-display text-[4.6cqw] leading-none @2xl:text-[1.75cqw]">
                  <span className="text-blood">Time</span> {FEST.proniteTime}
                </p>
              </div>
              <div className="flex items-center gap-[1.5cqw] @2xl:gap-[0.6cqw]">
                <div aria-hidden className="kit-barcode flex h-[14cqw] items-stretch gap-[2px] @2xl:h-[15cqw] @2xl:w-[4.4cqw] @2xl:flex-col @2xl:items-stretch">
                  {bars(serial).map((w, i) => (
                    <span
                      key={i}
                      className="block bg-ink"
                      style={{ "--w": `${w}px`, "--i": i, opacity: i % 7 === 0 ? 0.45 : 1 } as CSSProperties}
                    />
                  ))}
                </div>
                <p className="hidden font-[family-name:var(--font-mono)] text-[0.75cqw] tracking-[0.12em] text-ink/70 [writing-mode:vertical-rl] @2xl:block">
                  {serial}
                </p>
              </div>
            </div>

            <div className="flex items-end justify-between @2xl:block">
              <p className="t-display text-[7cqw] leading-none text-blood @2xl:text-[2.3cqw]">{price}</p>
              <p className="t-display text-[4.6cqw] leading-none @2xl:mt-[0.5cqw] @2xl:text-[1.5cqw]">Admit one</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
