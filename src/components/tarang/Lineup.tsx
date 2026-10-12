"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { CircleText } from "./Icons";
import { clamp, scrollVelocity, useScene } from "./motion";

export type LineupArtist = {
  id: string;
  name: string;
  night: number;
  date: string;
  time: string;
  detail: string;
  image: string | null;
};

const TILT = [-1.6, 1.2, -0.8, 1.8, -1.2];

/** One night, printed as a gig poster in the festival’s colours. */
function Poster({ artist, index }: { artist: LineupArtist; index: number }) {
  const night = String(artist.night).padStart(2, "0");
  return (
    <article
      data-card
      className="relative h-full shrink-0 will-change-transform"
      style={{ aspectRatio: "3 / 4", rotate: `${TILT[index % TILT.length]}deg` }}
    >
      <div className="t-halftone relative flex h-full flex-col overflow-hidden rounded-[6px] border-[3px] border-ink p-5 text-bone shadow-[10px_10px_0_0_var(--color-ink)] md:p-7">
        {artist.image && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={artist.image}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-80 mix-blend-luminosity grayscale contrast-125"
            />
            <div aria-hidden className="absolute inset-0 bg-blood mix-blend-multiply" />
          </>
        )}

        <div className="relative flex items-start justify-between">
          <p className="t-label">Night {night}</p>
          <p className="t-label text-right text-bone/75">
            {artist.date}
            <br />
            {artist.time}
          </p>
        </div>

        <p
          data-num
          aria-hidden
          className="t-display pointer-events-none absolute -right-3 top-[18%] text-[clamp(9rem,22vh,15rem)] leading-none text-transparent [-webkit-text-stroke:2px_rgba(244,234,200,0.55)] will-change-transform"
        >
          {night}
        </p>

        <div className="relative mt-auto">
          <h3 className="t-display t-cut text-[clamp(2.2rem,5.4vh,3.8rem)] leading-[0.92]">{artist.name}</h3>
          <p className="t-label mt-5 border-t-2 border-dashed border-bone/40 pt-4 text-bone/80">{artist.detail}</p>
        </div>
      </div>
    </article>
  );
}

/**
 * After dark. Vertical scroll drives a horizontal wall of gig posters across
 * a cream backdrop; cards lean with your scroll speed.
 */
export default function Lineup({ artists }: { artists: LineupArtist[] }) {
  const root = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const counter = useRef<HTMLSpanElement>(null);
  const span = useRef(0);
  const skew = useRef(0);
  const n = artists.length;

  useEffect(() => {
    const el = track.current;
    const section = root.current;
    if (!el || !section) return;
    const measure = () => {
      span.current = Math.max(0, el.scrollWidth - window.innerWidth);
      // One pixel of horizontal travel per pixel of scroll, plus a beat to settle.
      section.style.height = `calc(100svh + ${span.current}px + 20vh)`;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useScene(root, (_, el) => {
    const travelled = clamp(-el.getBoundingClientRect().top, 0, span.current);
    const p = span.current > 0 ? travelled / span.current : 0;
    const x = -travelled;
    skew.current += (Math.max(-6, Math.min(6, scrollVelocity() * 0.25)) - skew.current) * 0.12;
    if (track.current) {
      track.current.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
      track.current.querySelectorAll<HTMLElement>("[data-card]").forEach((card) => {
        card.style.transform = `skewX(${(-skew.current).toFixed(2)}deg)`;
        const r = card.getBoundingClientRect();
        const c = (r.left + r.width / 2) / window.innerWidth - 0.5;
        const num = card.querySelector<HTMLElement>("[data-num]");
        if (num) num.style.transform = `translate3d(${(c * -60).toFixed(1)}px,0,0)`;
      });
    }
    if (bar.current) bar.current.style.transform = `scaleX(${p.toFixed(4)})`;
    if (counter.current) counter.current.textContent = `0${Math.min(n, Math.floor(Math.min(p, 0.999) * n) + 1)}`;
  });

  if (n === 0) return null;

  return (
    <section id="lineup" ref={root} className="relative bg-bone text-ink" style={{ height: `${100 + n * 60}vh` }} aria-labelledby="lineup-title">
      <div className="sticky top-0 flex h-[100svh] flex-col overflow-hidden pb-8 pt-24 md:pb-10 md:pt-28">
        <div className="flex items-start justify-between gap-6 px-6 md:px-12">
          <p className="t-label border-t-2 border-ink pt-4 text-ink/60">(03) — After Dark</p>
          <p className="t-label border-t-2 border-ink pt-4 text-right text-ink/60">
            Night <span ref={counter}>01</span> / 0{n}
          </p>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center">
          <div ref={track} className="flex h-[min(64svh,620px,112vw)] items-center gap-8 pl-6 pr-[12vw] will-change-transform md:gap-14 md:pl-12">
            {/* Opening panel */}
            <div className="flex h-full w-[min(78vw,560px)] shrink-0 flex-col justify-center">
              <h2 id="lineup-title" className="t-display text-[clamp(3.6rem,9vw,8.5rem)] leading-[0.86]">
                Five
                <br />
                <span className="t-cut-red">nights.</span>
                <br />
                One stage.
              </h2>
              <p className="mt-8 max-w-sm text-base leading-relaxed text-ink/70">
                When the sun drops over the Ganga, the main stage becomes the loudest room on campus. Headliners drop one by one — keep
                scrolling.
              </p>
            </div>

            {artists.map((a, i) => (
              <Poster key={a.id} artist={a} index={i} />
            ))}

            {/* Closing panel */}
            <Link
              href="/schedule"
              className="group relative grid aspect-square h-[70%] shrink-0 place-items-center rounded-full bg-ink text-bone"
            >
              <CircleText
                id="lineup-stamp"
                text="Full schedule · Full schedule · "
                className="absolute inset-3 animate-[t-spin_18s_linear_infinite] text-bone/70"
              />
              <span className="t-display text-[clamp(2rem,4vw,3.4rem)] transition-transform duration-500 group-hover:rotate-[-8deg] group-hover:scale-110">
                All
                <br />
                nights →
              </span>
            </Link>
          </div>
        </div>

        <div className="px-6 md:px-12">
          <span className="relative block h-[3px] w-full overflow-hidden bg-ink/15">
            <span ref={bar} className="absolute inset-0 origin-left scale-x-0 bg-blood" />
          </span>
        </div>
      </div>
    </section>
  );
}
