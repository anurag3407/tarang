"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Plays an entrance once its children scroll into view.
 * - `fade`: rises and fades in
 * - `wipe`: uncovered bottom-up like a shutter lifting
 * - `stamp`: drops in oversized and lands at a slight angle
 * - `mask`: no motion of its own — triggers nested `.t-mask` letters/words
 */
export function Reveal({
  children,
  delay = 0,
  as: Tag = "div",
  variant = "fade",
  rotate,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  as?: "div" | "li";
  variant?: "fade" | "wipe" | "stamp" | "mask";
  /** Resting angle for `stamp`, in degrees. */
  rotate?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement & HTMLLIElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.dataset.shown = "true";
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const variantClass = { fade: "", wipe: "t-wipe", stamp: "t-stamp", mask: "t-masked" }[variant];
  return (
    <Tag
      ref={ref}
      className={`t-reveal ${variantClass} ${className}`}
      style={{ "--t-delay": `${delay}ms`, ...(rotate !== undefined && { "--t-rot": `${rotate}deg` }) } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

/** Splits a line into words that each rise out of a mask, in sequence. */
export function MaskedWords({ text, className = "", delay = 0 }: { text: string; className?: string; delay?: number }) {
  return (
    <Reveal className={className} variant="mask">
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(" ").map((w, i) => (
          <span key={i} className="t-mask mr-[0.22em]" style={{ "--t-delay": `${delay + i * 70}ms` } as CSSProperties}>
            <span>{w}</span>
          </span>
        ))}
      </span>
    </Reveal>
  );
}
