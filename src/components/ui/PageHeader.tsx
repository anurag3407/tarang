import Image from "next/image";
import { Fragment, type CSSProperties } from "react";
import { FEST } from "@/lib/data";

/** Splits a line into words that drop in, one after another, on page load. */
function Drop({ text, start = 0, className = "" }: { text: string; start?: number; className?: string }) {
  return (
    <span className={className}>
      {text.split(" ").map((w, i) => (
        <Fragment key={i}>
          {i > 0 && " "}
          <span className="kit-drop-mask">
            <span className="kit-drop" style={{ "--d": `${start + i * 90}ms` } as CSSProperties}>
              {w}
            </span>
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Inner-page masthead, printed like the poster: oxblood halftone field, a pair
 * of hands reaching in from the corner, and the title as an ink cut-out with
 * a cream keyline.
 */
export function PageHeader({
  kicker,
  title,
  accent,
  description,
}: {
  kicker: string;
  title: string;
  accent?: string;
  description?: string;
}) {
  const titleWords = title.split(" ").length;
  return (
    <section className="t-halftone relative isolate overflow-hidden border-b-[3px] border-ink">
      {/* Hands reach in from the top-right corner */}
      <div
        aria-hidden
        className="kit-hands pointer-events-none absolute -right-[18vw] -top-[6%] w-[min(92vw,720px)] opacity-90 md:-right-[6vw] md:-top-[22%]"
      >
        <Image src="/tarang/hands-top.webp" alt="" width={1407} height={833} loading="eager" sizes="(max-width: 768px) 92vw, 720px" className="h-auto w-full rotate-[-8deg]" />
      </div>

      <div className="relative mx-auto flex min-h-[min(68svh,640px)] max-w-7xl flex-col justify-end px-4 pb-12 pt-32 sm:px-6 md:pb-16 md:pt-40">
        <p className="t-label kit-fade flex items-center gap-3 text-bone/85">
          <span className="inline-block h-2 w-2 rounded-full bg-signal [animation:t-blink_1.2s_steps(1)_infinite]" />
          {kicker}
        </p>
        <h1 className="t-display mt-6 text-[clamp(3rem,9.5vw,8.5rem)] leading-[0.88]">
          <Drop text={title} className="t-cut block" />
          {accent && <Drop text={accent} start={titleWords * 90 + 60} className="block text-bone [text-shadow:5px_5px_0_var(--color-ink)]" />}
        </h1>
        {description && (
          <p className="kit-fade mt-8 max-w-2xl text-lg leading-relaxed text-bone/85 md:text-xl" style={{ animationDelay: "500ms" }}>
            {description}
          </p>
        )}
        <div className="kit-fade mt-12 flex items-center justify-between gap-6 border-t border-bone/25 pt-4" style={{ animationDelay: "700ms" }}>
          <span className="t-label text-bone/60">Tarang ’26 · Mute the mundane</span>
          <span className="t-label hidden text-bone/60 sm:inline">{FEST.datesShort}</span>
        </div>
      </div>
    </section>
  );
}
