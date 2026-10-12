"use client";

import Link from "next/link";
import { useRef, type CSSProperties, type PointerEvent } from "react";
import { SectionHead } from "./SectionHead";
import { Reveal } from "./Reveal";

export type PassTier = {
  id: string;
  tier: string;
  title: string;
  subtitle: string;
  price: string;
  serial: string;
  perks: string[];
  href: string;
  cta: string;
  featured?: boolean;
};

/** Deterministic barcode widths from the serial so SSR and client agree. */
function bars(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: 46 }, () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return 1 + (h % 3);
  });
}

const STUB = "8.5rem";

function Ticket({ pass }: { pass: PassTier }) {
  const card = useRef<HTMLDivElement>(null);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = card.current;
    if (!el || e.pointerType !== "mouse") return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.style.setProperty("--mx", `${x * 100}%`);
    el.style.setProperty("--my", `${y * 100}%`);
    el.style.transform = `perspective(1400px) rotateX(${(0.5 - y) * 7}deg) rotateY(${(x - 0.5) * 9}deg)`;
  };
  const onLeave = () => {
    const el = card.current;
    if (!el) return;
    el.style.transform = "perspective(1400px) rotateX(0) rotateY(0)";
  };

  const featured = pass.featured;
  // Semicircular notches where the stub tears off.
  const notch: CSSProperties = {
    WebkitMask:
      "radial-gradient(circle 14px at 0 var(--tear), transparent 98%, #000) left / 51% 100% no-repeat, radial-gradient(circle 14px at 100% var(--tear), transparent 98%, #000) right / 51% 100% no-repeat",
    mask: "radial-gradient(circle 14px at 0 var(--tear), transparent 98%, #000) left / 51% 100% no-repeat, radial-gradient(circle 14px at 100% var(--tear), transparent 98%, #000) right / 51% 100% no-repeat",
  };

  return (
    <div className="group flex h-full flex-col">
      <div
        ref={card}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        className="relative flex-1 transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform"
        style={{ "--tear": `calc(100% - ${STUB})`, ...notch } as CSSProperties}
      >
        <div
          className={`relative flex h-full flex-col overflow-hidden rounded-[14px] ${
            featured ? "text-ink" : "text-bone"
          }`}
          style={{
            background: featured
              ? "linear-gradient(140deg, #e9d3a6 0%, #c9a46a 38%, #9c7a43 62%, #d8bd88 100%)"
              : "linear-gradient(160deg, #1d1a17 0%, #12100e 100%)",
            boxShadow: featured
              ? "0 40px 80px -30px rgba(201,164,106,0.45)"
              : "inset 0 0 0 1px rgba(238,232,221,0.12), 0 40px 80px -40px rgba(0,0,0,0.8)",
          }}
        >
          {/* foil sheen follows the cursor */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100"
            style={{
              background: featured
                ? "radial-gradient(40% 35% at var(--mx,50%) var(--my,50%), rgba(255,255,255,0.55), transparent 70%)"
                : "radial-gradient(40% 35% at var(--mx,50%) var(--my,50%), rgba(201,164,106,0.18), transparent 70%)",
              mixBlendMode: featured ? "soft-light" : "normal",
            }}
          />
          {/* guilloche lines */}
          <svg aria-hidden viewBox="0 0 400 200" className="pointer-events-none absolute inset-x-0 top-0 h-[55%] w-full opacity-[0.14]" preserveAspectRatio="none">
            {Array.from({ length: 18 }, (_, i) => (
              <path
                key={i}
                d={`M0 ${40 + i * 7} C 100 ${10 + i * 7}, 300 ${90 + i * 7}, 400 ${40 + i * 7}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="0.6"
              />
            ))}
          </svg>

          <div className="relative flex flex-1 flex-col p-7 md:p-9" style={{ minHeight: "30rem" }}>
            <div className="flex items-start justify-between">
              <span className="t-label">Tarang ’26</span>
              <span className={`t-label ${featured ? "text-ink/60" : "text-bone/50"}`}>{pass.serial}</span>
            </div>

            <div className="mt-14">
              <p className={`t-label ${featured ? "text-ink/60" : "text-brass"}`}>{pass.tier}</p>
              <h3 className="t-display mt-3 text-[clamp(3.5rem,6vw,5.5rem)] italic">{pass.title}</h3>
              <p className={`mt-3 text-sm ${featured ? "text-ink/70" : "text-bone/60"}`}>{pass.subtitle}</p>
            </div>

            <ul className="mt-10">
              {pass.perks.map((perk) => (
                <li
                  key={perk}
                  className={`flex gap-4 border-t py-3 text-[0.92rem] leading-snug ${featured ? "border-ink/15" : "border-bone/10"}`}
                >
                  <span className={`t-label mt-[0.2rem] text-[0.6rem] ${featured ? "text-ink/50" : "text-brass"}`}>✦</span>
                  {perk}
                </li>
              ))}
            </ul>

          </div>

          {/* stub — torn along the dashed line */}
          <div
            className={`relative flex items-end justify-between gap-6 border-t border-dashed px-7 pb-7 md:px-9 md:pb-8 ${featured ? "border-ink/30" : "border-bone/20"}`}
            style={{ height: STUB }}
          >
            <div>
              <p className={`t-label ${featured ? "text-ink/60" : "text-bone/50"}`}>Admit one · 5 days</p>
              <p className="t-display mt-2 text-5xl">{pass.price}</p>
            </div>
            <div className="flex h-12 items-stretch gap-[2px]" aria-hidden>
              {bars(pass.serial).map((w, i) => (
                <span key={i} className={featured ? "bg-ink/80" : "bg-bone/70"} style={{ width: w, opacity: i % 5 === 0 ? 0.4 : 1 }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <Link
        href={pass.href}
        className={`t-btn mt-6 justify-between ${featured ? "t-btn-solid" : "t-btn-ghost"}`}
      >
        {pass.cta} <span className="t-btn-arrow">→</span>
      </Link>
    </div>
  );
}

export default function Passes({ passes }: { passes: PassTier[] }) {
  return (
    <section id="passes" className="relative px-6 py-32 md:px-12 md:py-48">
      <div className="mx-auto max-w-[1400px]">
        <SectionHead
          index="06"
          label="Passes"
          title={
            <>
              Choose your <em className="text-brass">access.</em>
            </>
          }
          aside="Taking a Delegate Card? You don’t need a BR Card — it already covers everything the BR Card does, and every headline night."
        />

        <div className="mx-auto mt-20 grid max-w-5xl gap-10 md:mt-28 md:grid-cols-2 md:gap-12">
          {passes.map((p, i) => (
            <Reveal key={p.id} delay={i * 140} className="h-full">
              <Ticket pass={p} />
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-16 text-center">
          <p className="t-label text-bone/45">
            Digital QR issued instantly · Collect wristbands at the CR Desk ·{" "}
            <Link href="/faqs" className="t-link text-bone/70">
              Pass FAQs
            </Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
