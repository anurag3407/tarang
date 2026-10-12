import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

/** Numbered editorial header shared by every landing section. */
export function SectionHead({
  index,
  label,
  title,
  aside,
}: {
  index: string;
  label: string;
  title: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="grid gap-10 border-t border-bone/12 pt-6 md:grid-cols-12 md:gap-6">
      <Reveal className="md:col-span-3">
        <p className="t-label text-bone/50">
          ({index}) — {label}
        </p>
      </Reveal>
      <Reveal delay={80} className="md:col-span-6">
        <h2 className="t-display text-[clamp(2.6rem,5.6vw,5.5rem)]">{title}</h2>
      </Reveal>
      {aside && (
        <Reveal delay={160} className="md:col-span-3 md:pt-3">
          <div className="max-w-xs text-[0.95rem] leading-relaxed text-bone/60">{aside}</div>
        </Reveal>
      )}
    </div>
  );
}
