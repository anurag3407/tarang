import type { CSSProperties, ReactNode } from "react";

/**
 * TARANG, set live in Noot — the poster’s face — as ink letters with a cream
 * keyline. Each letter is its own span so it can move independently: animate
 * the outer `[data-letter]` span from JS, the inner span with CSS.
 *
 * The lockup sizes itself to its container’s width (container query units), so
 * give it a width and the type fills it.
 */
export const WORD = "TARANG";

export default function Wordmark({
  className = "",
  letterClassName = "",
  innerClassName = "",
  letterStyle,
  label = "Tarang",
  tone = "cut",
}: {
  className?: string;
  /** Applied to the positioned span — animate this from JS. */
  letterClassName?: string;
  /** Applied to the span inside — animate this with CSS. */
  innerClassName?: string;
  letterStyle?: (i: number) => CSSProperties;
  label?: string;
  /** `cut`: ink with cream keyline (on red). `hollow`: keyline only (on ink). */
  tone?: "cut" | "hollow";
  /** Accepted for older call sites; the wordmark is text now, so nothing to preload. */
  eager?: boolean;
  sizes?: string;
}): ReactNode {
  return (
    <div role="img" aria-label={label} className={`kit-wordmark ${className}`}>
      <span aria-hidden className={`kit-wordmark-line ${tone === "hollow" ? "t-hollow-mark" : "t-cut"}`}>
        {Array.from(WORD).map((ch, i) => (
          <span key={i} data-letter={i} className={`inline-block ${letterClassName}`} style={letterStyle?.(i)}>
            <span className={`inline-block ${innerClassName}`} style={{ "--i": i } as CSSProperties}>
              {ch}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}
