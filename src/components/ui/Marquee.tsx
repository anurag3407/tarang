import { Ring } from "@/components/tarang/Icons";

/** A strip of tape running across the page — the inner-page cousin of the landing marquee. */
export function Marquee({
  items,
  variant = "black",
  fast = false,
}: {
  items: string[];
  variant?: "black" | "secondary" | "accent";
  fast?: boolean;
}) {
  const tone =
    variant === "black"
      ? { band: "bg-ink text-bone", word: "", ring: "text-signal" }
      : variant === "secondary"
        ? { band: "bg-bone text-ink", word: "", ring: "text-blood" }
        : { band: "t-halftone text-bone", word: "t-cut", ring: "text-bone" };

  const row = (ariaHidden: boolean) => (
    <div aria-hidden={ariaHidden} className="flex shrink-0 items-center">
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className="flex items-center">
          <span className={`t-display whitespace-nowrap px-6 text-2xl md:px-8 md:text-4xl ${tone.word}`}>{item}</span>
          <Ring className={`h-6 w-6 shrink-0 md:h-7 md:w-7 ${tone.ring}`} />
        </span>
      ))}
    </div>
  );

  return (
    <div className={`marquee-paused relative overflow-hidden border-y-[3px] border-ink py-4 md:py-5 ${tone.band}`}>
      <div className={fast ? "marquee-track-fast" : "marquee-track"}>
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
