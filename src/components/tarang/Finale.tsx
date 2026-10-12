import Link from "next/link";
import { FEST } from "@/lib/data";
import WaveLines from "./WaveLines";
import { Reveal } from "./Reveal";

export default function Finale() {
  return (
    <section className="relative overflow-hidden px-6 pb-32 pt-24 md:px-12 md:pb-44">
      <WaveLines className="pointer-events-none absolute inset-x-0 top-1/2 h-[70%] w-full -translate-y-1/2" />
      <div className="relative mx-auto flex max-w-[1400px] flex-col items-center text-center">
        <Reveal>
          <p className="t-label text-bone/50">(09) — {FEST.dates}</p>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="t-display mt-10 text-[clamp(3.5rem,11vw,12rem)] leading-[0.88]">
            See you on
            <br />
            <em className="text-brass">the wave.</em>
          </h2>
        </Reveal>
        <Reveal delay={200} className="mt-14 flex flex-wrap justify-center gap-3">
          <Link href="/delegate-card" className="t-btn t-btn-solid">
            Get Delegate Card <span className="t-btn-arrow">→</span>
          </Link>
          <Link href="/basic-card" className="t-btn t-btn-ghost">
            Get BR Card
          </Link>
        </Reveal>
        <Reveal delay={260}>
          <p className="t-label mt-16 max-w-md leading-loose text-bone/40">{FEST.venue}</p>
        </Reveal>
      </div>
    </section>
  );
}
