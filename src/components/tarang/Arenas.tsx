import Link from "next/link";
import { SectionHead } from "./SectionHead";
import { Reveal } from "./Reveal";

export type Arena = { slug: string; name: string; tagline: string; count: number };

export default function Arenas({ arenas, total }: { arenas: Arena[]; total: number }) {
  return (
    <section className="relative px-6 py-32 md:px-12 md:py-48">
      <div className="mx-auto max-w-[1400px]">
        <SectionHead
          index="07"
          label="Arenas"
          title={
            <>
              Eight stages.
              <br />
              <em className="text-brass">Pick yours.</em>
            </>
          }
          aside={
            <>
              From battle of the bands to box cricket, every kind of competitor has a floor at Tarang.{" "}
              {total > 0 && <span className="text-bone/85">{total} events and counting.</span>}
            </>
          }
        />

        <ul className="mt-20 border-b border-bone/12 md:mt-28">
          {arenas.map((a, i) => (
            <Reveal as="li" key={a.slug} delay={i * 50}>
              <Link
                href={`/events?category=${a.slug}`}
                className="group relative grid grid-cols-12 items-center gap-4 border-t border-bone/12 py-7 md:py-9"
              >
                {/* hover wash */}
                <span
                  aria-hidden
                  className="absolute inset-0 origin-bottom scale-y-0 bg-bone transition-transform duration-[650ms] ease-[cubic-bezier(0.7,0,0.2,1)] group-hover:scale-y-100"
                />
                <span className="t-label relative col-span-2 text-bone/40 transition-colors duration-500 group-hover:text-ink/50 md:col-span-1 md:pl-4">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="t-display relative col-span-10 text-[clamp(2.4rem,5.5vw,5.25rem)] transition-[color,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-3 group-hover:italic group-hover:text-ink md:col-span-6">
                  {a.name}
                </span>
                <span className="relative col-span-10 col-start-3 text-sm text-bone/55 transition-colors duration-500 group-hover:text-ink/70 md:col-span-3 md:col-start-auto">
                  {a.tagline}
                </span>
                <span className="t-label relative col-span-12 flex items-center justify-start gap-3 text-bone/60 transition-colors duration-500 group-hover:text-ink md:col-span-2 md:justify-end md:pr-4">
                  {a.count > 0 ? `${a.count} events` : "View"}
                  <span className="transition-transform duration-500 group-hover:translate-x-1">→</span>
                </span>
              </Link>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}
