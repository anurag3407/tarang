import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

/** Numbered header shared by the landing sections: a slugline, then a shutter-wiped title. */
export function SectionHead({
  index,
  label,
  title,
  aside,
  id,
}: {
  index: string;
  label: string;
  title: ReactNode;
  aside?: ReactNode;
  id?: string;
}) {
  return (
    <div className="grid gap-10 md:grid-cols-12 md:gap-6">
      <div className="flex items-start justify-between gap-6 border-t border-bone/15 pt-5 md:col-span-12">
        <p className="t-label text-bone/50">
          ({index}) — {label}
        </p>
        <p className="t-label text-bone/30">Tarang ’26</p>
      </div>
      <Reveal variant="wipe" delay={60} className="md:col-span-8">
        <h2 id={id} className="t-display text-[clamp(2.9rem,7.2vw,7rem)] leading-[0.88]">
          {title}
        </h2>
      </Reveal>
      {aside && (
        <Reveal delay={200} className="md:col-span-4 md:self-end">
          <div className="max-w-sm text-[0.98rem] leading-relaxed text-bone/60 md:ml-auto">{aside}</div>
        </Reveal>
      )}
    </div>
  );
}
