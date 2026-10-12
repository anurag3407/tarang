import Link from "next/link";
import type { ReactNode } from "react";

type Variant = "primary" | "secondary" | "muted" | "outline" | "dark";

/** Sticker buttons — the same family as the landing page’s `.t-btn`. */
const styles: Record<Variant, string> = {
  primary: "keep-border-black border-signal bg-[#d4190f] text-bone [--kit-shadow:var(--color-ink)]",
  secondary: "keep-border-black border-bone bg-bone text-ink [--kit-shadow:#8f0c08]",
  muted: "keep-border-black border-bone/40 bg-ink-3 text-bone [--kit-shadow:#8f0c08]",
  outline: "keep-border-black border-bone bg-transparent text-bone hover:bg-bone hover:text-ink [--kit-shadow:#8f0c08]",
  dark: "keep-border-black border-bone bg-ink text-bone [--kit-shadow:#8f0c08]",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-full border-2 px-6 py-3 " +
  "font-[family-name:var(--font-mono)] text-xs font-medium uppercase tracking-[0.16em] " +
  "shadow-[4px_4px_0_0_var(--kit-shadow)] transition-[transform,box-shadow,background-color,color] duration-200 " +
  "hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--kit-shadow)] " +
  "active:translate-x-[3px] active:translate-y-[3px] active:shadow-[1px_1px_0_0_var(--kit-shadow)] " +
  "disabled:pointer-events-none disabled:opacity-50 " +
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-bone";

export function ButtonLink({
  href,
  variant = "primary",
  className = "",
  children,
}: {
  href: string;
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </Link>
  );
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
}) {
  return (
    <button className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
