import Image from "next/image";
import type { CSSProperties, ReactNode } from "react";

/**
 * The TARANG lettering from the poster, cut into six letters so each can move
 * on its own. Offsets are percentages of the full lockup (1181 × 282), so the
 * letters re-join seamlessly when at rest.
 */
export const LETTERS = [
  { left: 0, width: 15.411, px: 182 },
  { left: 15.411, width: 16.935, px: 200 },
  { left: 32.345, width: 16.596, px: 196 },
  { left: 48.942, width: 16.765, px: 198 },
  { left: 65.707, width: 16.85, px: 199 },
  { left: 82.557, width: 17.443, px: 206 },
] as const;

export const WORDMARK_RATIO = 1181 / 282;

export default function Wordmark({
  className = "",
  letterClassName = "",
  innerClassName = "",
  letterStyle,
  eager = false,
  sizes = "(max-width: 768px) 15vw, 160px",
  label = "Tarang",
}: {
  className?: string;
  /** Applied to the positioned span — animate this from JS. */
  letterClassName?: string;
  /** Applied to the span inside — animate this with CSS. */
  innerClassName?: string;
  letterStyle?: (i: number) => CSSProperties;
  /** Load immediately — for above-the-fold placements. */
  eager?: boolean;
  sizes?: string;
  label?: string;
}): ReactNode {
  return (
    <div role="img" aria-label={label} className={`relative ${className}`} style={{ aspectRatio: `${WORDMARK_RATIO}` }}>
      {LETTERS.map((l, i) => (
        <span
          key={i}
          data-letter={i}
          className={`absolute top-0 block h-full ${letterClassName}`}
          style={{ left: `${l.left}%`, width: `${l.width + 0.08}%`, ...letterStyle?.(i) }}
        >
          <span className={`block h-full w-full ${innerClassName}`} style={{ "--i": i } as CSSProperties}>
            <Image
              src={`/tarang/l${i}.webp`}
              alt=""
              width={l.px}
              height={282}
              loading={eager ? "eager" : "lazy"}
              sizes={sizes}
              draggable={false}
              className="h-full w-full select-none"
            />
          </span>
        </span>
      ))}
    </div>
  );
}
