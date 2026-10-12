"use client";

import Link from "next/link";
import { useRef, type PointerEvent } from "react";
import { SectionHead } from "./SectionHead";
import { Reveal } from "./Reveal";
import { Ring } from "./Icons";
import { onFrame } from "./motion";

export type Arena = { slug: string; name: string; tagline: string; count: number };

/**
 * Every competition floor as a row. Hovering floods the row red and the name
 * turns into a poster cut-out, while a spinning badge trails the pointer.
 */
export default function Arenas({ arenas, total }: { arenas: Arena[]; total: number }) {
  const list = useRef<HTMLUListElement>(null);
  const badge = useRef<HTMLDivElement>(null);
  const badgeText = useRef<HTMLSpanElement>(null);
  const stop = useRef<(() => void) | null>(null);
  const pos = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

  const start = () => {
    if (stop.current) return;
    stop.current = onFrame(() => {
      const p = pos.current;
      p.x += (p.tx - p.x) * 0.16;
      p.y += (p.ty - p.y) * 0.16;
      if (badge.current) badge.current.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0)`;
    });
  };

  const onMove = (e: PointerEvent<HTMLUListElement>) => {
    if (e.pointerType !== "mouse" || !list.current || !badge.current) return;
    const r = list.current.getBoundingClientRect();
    const p = pos.current;
    p.tx = e.clientX - r.left;
    p.ty = e.clientY - r.top;
    const row = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-count]") : null;
    if (badgeText.current && row) badgeText.current.textContent = row.dataset.count ?? "";
    badge.current.dataset.on = String(Boolean(row));
    start();
  };

  const onLeave = () => {
    if (badge.current) badge.current.dataset.on = "false";
    stop.current?.();
    stop.current = null;
  };

  return (
    <section className="relative px-6 py-32 md:px-12 md:py-44" aria-labelledby="arenas-title">
      <div className="mx-auto max-w-[1400px]">
        <SectionHead
          index="05"
          label="Arenas"
          id="arenas-title"
          title={
            <>
              Pick a floor.
              <br />
              <span className="t-cut-red">Make noise.</span>
            </>
          }
          aside={
            <>
              From battle of the bands to box cricket, every kind of competitor gets a stage at Tarang.{" "}
              {total > 0 && <span className="text-bone">{total} events and counting.</span>}
            </>
          }
        />

        <ul ref={list} onPointerMove={onMove} onPointerLeave={onLeave} className="relative mt-20 border-b border-bone/15 md:mt-28">
          {arenas.map((a, i) => (
            <Reveal as="li" key={a.slug} delay={i * 60} variant="wipe">
              <Link
                href={`/events?category=${a.slug}`}
                data-count={a.count > 0 ? `${a.count} events` : "Enter"}
                className="group relative grid grid-cols-12 items-center gap-4 overflow-hidden border-t border-bone/15 py-6 md:py-8"
              >
                <span
                  aria-hidden
                  className="t-halftone absolute inset-0 origin-left scale-x-0 transition-transform duration-[650ms] ease-[cubic-bezier(0.7,0,0.2,1)] group-hover:scale-x-100 group-focus-visible:scale-x-100"
                />
                <span className="t-label relative col-span-2 text-bone/40 transition-colors duration-500 group-hover:text-bone md:col-span-1 md:pl-4">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="t-display relative col-span-10 text-[clamp(2rem,5vw,4.6rem)] transition-[transform,color,-webkit-text-stroke] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] [-webkit-text-stroke:0_var(--color-bone)] [paint-order:stroke_fill] group-hover:translate-x-4 group-hover:text-ink group-hover:[-webkit-text-stroke:0.14em_var(--color-bone)] md:col-span-6">
                  {a.name}
                </span>
                <span className="relative col-span-10 col-start-3 text-sm text-bone/55 transition-colors duration-500 group-hover:text-bone md:col-span-3 md:col-start-auto">
                  {a.tagline}
                </span>
                <span className="t-label relative col-span-12 flex items-center justify-start gap-3 text-bone/60 transition-colors duration-500 group-hover:text-bone md:col-span-2 md:justify-end md:pr-4">
                  {a.count > 0 ? `${a.count} events` : "View"}
                  <span className="transition-transform duration-500 group-hover:translate-x-1">→</span>
                </span>
              </Link>
            </Reveal>
          ))}

          {/* Trailing badge */}
          <div
            ref={badge}
            aria-hidden
            data-on="false"
            className="group/b pointer-events-none absolute left-0 top-0 z-10 hidden md:block"
          >
            <div className="-translate-x-1/2 -translate-y-1/2 scale-0 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-data-[on=true]/b:scale-100">
              <div className="relative grid h-32 w-32 place-items-center rounded-full border-[3px] border-ink bg-bone text-ink shadow-[6px_6px_0_0_var(--color-ink)]">
                <Ring className="absolute inset-3 animate-[t-spin_6s_linear_infinite] text-blood/25" />
                <span ref={badgeText} className="t-label relative max-w-[5.5rem] text-center leading-snug text-ink">
                  Enter
                </span>
              </div>
            </div>
          </div>
        </ul>
      </div>
    </section>
  );
}
