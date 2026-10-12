import type { ReactNode } from "react";

type Variant = "accent" | "secondary" | "muted" | "white" | "black";

/** Slug-line chips. Accent is poster red, secondary a cream sticker, the rest sit on ink. */
const styles: Record<Variant, string> = {
  accent: "border-[#d4190f] bg-[#d4190f] text-bone",
  secondary: "border-bone bg-bone text-ink",
  muted: "border-bone/25 bg-ink-3 text-bone",
  white: "border-bone/40 bg-ink-2 text-bone",
  black: "border-bone bg-ink text-bone",
};

const base =
  "keep-border-black inline-flex items-center gap-1.5 border px-3 py-1 font-[family-name:var(--font-mono)] text-[0.68rem] font-medium uppercase tracking-[0.16em]";

export function Badge({
  variant = "secondary",
  className = "",
  children,
}: {
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return <span className={`${base} ${styles[variant]} ${className}`}>{children}</span>;
}

export function PillBadge({
  variant = "accent",
  className = "",
  children,
}: {
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return <span className={`${base} rounded-full px-4 ${styles[variant]} ${className}`}>{children}</span>;
}
